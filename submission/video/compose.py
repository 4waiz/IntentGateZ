"""Edits the demo video from the recorded clips, the overlays and the narration.

    node submission/video/record.mjs        # raw/*.webm + markers (live LinuxONE deployment)
    node submission/video/overlays.mjs      # build/overlays/*.png
    python submission/video/compose.py      # out/IntentGateZ_demo.mp4

Each segment lasts exactly as long as its narration line (timings.json), so picture and voice
stay in sync. Footage is only cut, gently slowed (never below 0.62x) or zoomed; nothing on
screen is generated except the labelled overlays, whose numbers come from ml/results.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW, BUILD, OUT = HERE / "raw", HERE / "build", HERE / "out"
NORM, PARTS, SEGS, FRAMES, OVL = BUILD / "norm", BUILD / "parts", BUILD / "segs", BUILD / "frames", BUILD / "overlays"
FPS, W, H = 30, 1920, 1080
LEAD = 0.8  # seconds of picture before the narration starts
TAIL = 3.2  # seconds of end card after the last line


def ff(*args: str) -> None:
    cmd = ["ffmpeg", "-v", "error", "-y", *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"ffmpeg failed: {' '.join(cmd)}\n{r.stderr[-2000:]}")


ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", "-r", str(FPS)]


def normalize(name: str) -> Path:
    out = NORM / f"{name}.mp4"
    src = RAW / f"{name}.webm"
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
        ff("-i", str(src), "-vf", f"fps={FPS},scale={W}:{H}:flags=lanczos", *ENC, "-an", str(out))
    return out


def still(name: str, t: float) -> Path:
    out = FRAMES / f"{name}_{t:g}.png"
    if not out.exists():
        ff("-ss", f"{t:.3f}", "-i", str(normalize(name)), "-frames:v", "1", str(out))
    return out


def ease(n_expr: str, n_total: int) -> str:
    """smoothstep(0..1) of frame index for ffmpeg expressions."""
    k = f"clip(({n_expr})/{max(1, n_total - 1)},0,1)"
    return f"({k}*{k}*(3-2*{k}))"


# ------------------------------------------------------------------------------------- parts


def part_clip(out: Path, src: str, a: float, dur: float, speed: float = 1.0, pan: tuple | None = None) -> None:
    """Range of a recorded clip starting at a, played at `speed`, lasting `dur` seconds of output.
    pan = (zoom, x, y0, y1, frac): fixed zoom, crop x, crop y easing y0 -> y1 over the first frac of the part."""
    span = dur * speed
    vf = [f"setpts=(PTS-STARTPTS)/{speed}", f"fps={FPS}"]
    if pan:
        z, x, y0, y1, frac = pan
        zw, zh = int(round(W * z / 2) * 2), int(round(H * z / 2) * 2)
        n = max(2, int(dur * frac * FPS))
        y = f"{y0}+({y1}-{y0})*{ease('n', n)}"
        vf += [f"scale={zw}:{zh}:flags=lanczos", f"crop={W}:{H}:{x}:'{y}'"]
    vf.append(f"tpad=stop_mode=clone:stop_duration=1")
    ff("-ss", f"{a:.3f}", "-t", f"{span + 0.5:.3f}", "-i", str(normalize(src)), "-vf", ",".join(vf), "-t", f"{dur:.3f}", *ENC, "-an", str(out))


def part_zoom(out: Path, img: Path, dur: float, frm: tuple, to: tuple) -> None:
    """Ken Burns move on a still: (cx, cy, zoom) -> (cx, cy, zoom) in 1920x1080 coordinates."""
    n = max(2, int(round(dur * FPS)))
    e = ease("on", n)
    z = f"({frm[2]}+({to[2]}-{frm[2]})*{e})"
    cx = f"(({frm[0]}+({to[0]}-{frm[0]})*{e})*2)"
    cy = f"(({frm[1]}+({to[1]}-{frm[1]})*{e})*2)"
    zp = f"zoompan=z='{z}':x='clip({cx}-iw/zoom/2,0,iw-iw/zoom)':y='clip({cy}-ih/zoom/2,0,ih-ih/zoom)':d=1:s={W}x{H}:fps={FPS}"
    ff("-loop", "1", "-framerate", str(FPS), "-t", f"{dur + 0.2:.3f}", "-i", str(img), "-vf", f"scale={W * 2}:{H * 2}:flags=lanczos,{zp}", "-t", f"{dur:.3f}", *ENC, "-an", str(out))


# ---------------------------------------------------------------------------------- timeline


def timeline() -> list[dict]:
    tm = json.loads((HERE / "timings.json").read_text())
    starts = {s["id"]: s["start"] for s in tm["segments"]}
    last = tm["segments"][-1]
    order = [s["id"] for s in tm["segments"]]
    bounds = [0.0] + [starts[i] + LEAD for i in order[1:]] + [last["start"] + LEAD + last["duration"] + TAIL]
    dur = {sid: bounds[k + 1] - bounds[k] for k, sid in enumerate(order)}
    # pauses inside each narration line (silencedetect on audio/<id>.wav) drive the cut points
    return [
        {"id": "s01_hook", "dur": dur["s01_hook"],
         "parts": [("clip", "city", 0.0, None, 1.0, None)],
         "ovl": [("title_hook", 0.7, dur["s01_hook"] - 0.5, 0.6)]},
        {"id": "s02_problem", "dur": dur["s02_problem"],
         "parts": [("clip", "city", 9.89, None, 1.0, None)],
         "dim": 0.58,
         "ovl": [("problem_1", 0.25, 6.75, 0.45), ("problem_2", 6.95, dur["s02_problem"] - 0.25, 0.45)]},
        {"id": "s03_solution", "dur": dur["s03_solution"],
         "parts": [("clip", "console", 1.0, 4.09, 1.0, None),
                   ("zoom", ("proof", 5.5), 10.62, (946, 450, 1.3), (900, 455, 1.42)),
                   ("zoom", ("proof", 5.5), None, (900, 455, 1.42), (1240, 470, 1.85))],
         "ovl": [("ch_gateway", 0.15, 3.9, 0.35)]},
        {"id": "s04_allow", "dur": dur["s04_allow"],
         "parts": [("clip", "present", 4.71, (9.68 - 4.71) / 0.8, 0.8, None),
                   ("clip", "present", 9.68, None, 1.0, None)]},
        {"id": "s05_challenge", "dur": dur["s05_challenge"],
         "parts": [("clip", "present", 15.43, 3.17, 1.0, None),
                   ("clip", "present", 20.42, 2.47, 1.0, None),
                   ("clip", "challenge", 2.6, 2.72, 1.0, (5 / 3, 1280, 0, 0, 0.5)),
                   ("clip", "challenge", 5.4, 5.57, 1.0, (5 / 3, 1280, 0, 420, 0.85)),
                   ("clip", "challenge", 13.3, None, 1.0, (5 / 3, 1280, 420, 720, 0.45))],
         "ovl": [("ch_challenge", 5.75, dur["s05_challenge"] - 0.2, 0.35)]},
        {"id": "s06_block", "dur": dur["s06_block"],
         "parts": [("clip", "present", 39.95, (43.47 - 39.95) / 0.62, 0.62, None),
                   ("clip", "present", 43.47, 2.0, 0.75, None),
                   ("clip", "present", 44.97, (50.58 - 44.97) / 0.8, 0.8, None),
                   ("clip", "present", 50.58, None, 0.62, None)]},
        {"id": "s07_drift", "dur": dur["s07_drift"],
         "parts": [("clip", "present", 61.27, (64.39 - 61.27) / 0.9, 0.9, None),
                   ("clip", "present", 66.27, 4.93, 1.0, None),
                   ("clip", "present", 71.93, None, 1.0, None)]},
        {"id": "s08_ibmz", "dur": dur["s08_ibmz"],
         "parts": [("zoom", ("proof", 12.0), 6.32, (946, 400, 1.3), (946, 420, 1.38)),
                   ("zoom", ("proof", 21.0), 9.89, (946, 470, 1.25), (1283, 455, 1.6)),
                   ("zoom", OVL / "nnpa_slide.png", 5.34, (960, 540, 1.0), (960, 540, 1.04)),
                   ("zoom", ("proof", 12.0), None, (1280, 380, 1.5), (1280, 380, 1.56))],
         "ovl": [("ch_ibmz", 0.2, 6.0, 0.35), ("ibmz_latency", 21.65, dur["s08_ibmz"] - 0.15, 0.4)]},
        {"id": "s09_results", "dur": dur["s09_results"],
         "parts": [("zoom", ("proof", 33.0), 12.61, (1271, 470, 1.75), (1271, 470, 1.9)),
                   ("zoom", ("proof", 25.5), None, (946, 830, 1.5), (946, 830, 1.65))],
         "ovl": [("ch_results", 0.2, 3.0, 0.35), ("results_card", 2.9, 12.4, 0.45)]},
        {"id": "s10_close", "dur": dur["s10_close"],
         "parts": [("clip", "present", 77.59, None, 1.0, None)],
         "ovl": [("end_links", 0.9, dur["s10_close"] + 1.0, 0.5)]},
    ]


def build_segment(seg: dict) -> Path:
    files = []
    used = 0.0
    for k, p in enumerate(seg["parts"]):
        kind = p[0]
        dur = (seg["dur"] - used) if (p[3] if kind == "clip" else p[2]) is None else (p[3] if kind == "clip" else p[2])
        dur = round(dur, 3)
        out = PARTS / f"{seg['id']}_{k}.mp4"
        if kind == "clip":
            _, src, a, _, speed, pan = p
            part_clip(out, src, a, dur, speed, pan)
        else:
            _, img, _, frm, to = p
            img = still(*img) if isinstance(img, tuple) else img
            part_zoom(out, img, dur, frm, to)
        files.append(out)
        used += dur
    if abs(used - seg["dur"]) > 0.02:
        sys.exit(f"{seg['id']}: parts last {used:.3f}s, segment needs {seg['dur']:.3f}s")

    lst = PARTS / f"{seg['id']}.txt"
    lst.write_text("".join(f"file '{f.as_posix()}'\n" for f in files))
    inputs = ["-f", "concat", "-safe", "0", "-i", str(lst)]
    chains, last, idx = [], "[0:v]", 1
    D = seg["dur"]
    if seg.get("dim"):
        inputs += ["-f", "lavfi", "-t", f"{D:.3f}", "-i", f"color=c=black:s={W}x{H}:r={FPS}"]
        chains.append(f"[{idx}:v]format=rgba,colorchannelmixer=aa={seg['dim']},fade=t=in:st=0:d=0.6:alpha=1[dim]")
        chains.append(f"{last}[dim]overlay=0:0[b{idx}]")
        last, idx = f"[b{idx}]", idx + 1
    for name, a, b, f in seg.get("ovl", []):
        inputs += ["-loop", "1", "-framerate", str(FPS), "-t", f"{D:.3f}", "-i", str(OVL / f"{name}.png")]
        fades = f"fade=t=in:st={a:.3f}:d={f}:alpha=1"
        if b < D:
            fades += f",fade=t=out:st={max(a + f, b - f):.3f}:d={f}:alpha=1"
        chains.append(f"[{idx}:v]format=rgba,{fades}[o{idx}]")
        chains.append(f"{last}[o{idx}]overlay=0:0:format=auto[b{idx}]")
        last, idx = f"[b{idx}]", idx + 1
    out = SEGS / f"{seg['id']}.mp4"
    if chains:
        ff(*inputs, "-filter_complex", ";".join(chains), "-map", last, "-t", f"{D:.3f}", *ENC, "-an", str(out))
    else:
        ff(*inputs, "-t", f"{D:.3f}", *ENC, "-an", str(out))
    return out


def main() -> None:
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH")
    for d in (NORM, PARTS, SEGS, FRAMES, OUT):
        d.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    segs = timeline()
    total = sum(s["dur"] for s in segs)
    built = []
    for s in segs:
        if not only or s["id"] in only or not (SEGS / f"{s['id']}.mp4").exists():
            print(f"segment {s['id']}  {s['dur']:.3f}s")
            build_segment(s)
        built.append(SEGS / f"{s['id']}.mp4")
    lst = SEGS / "all.txt"
    lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in built))
    out = OUT / "IntentGateZ_demo.mp4"
    ff(
        "-f", "concat", "-safe", "0", "-i", str(lst),
        "-i", str(HERE / "audio" / "narration_full.wav"),
        "-filter_complex",
        f"[0:v]fade=t=in:st=0:d=0.6,fade=t=out:st={total - 0.9:.3f}:d=0.9,format=yuv420p[v];"
        f"[1:a]aresample=48000,adelay={int(LEAD * 1000)},apad,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo[a]",
        "-map", "[v]", "-map", "[a]", "-t", f"{total:.3f}",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-r", str(FPS), "-g", str(FPS * 2),
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out),
    )
    print(f"wrote {out} ({total:.1f}s, {out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
