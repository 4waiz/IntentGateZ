"""Generate the narration audio with Kokoro-82M (Apache-2.0, runs locally, no account).

    python submission/video/make_voiceover.py --model-dir <dir with kokoro-v1.0.onnx and voices-v1.0.bin>

Writes one WAV per segment plus timings.json (durations) and captions.srt.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).resolve().parent


def srt_time(t: float) -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int((s % 1) * 1000):03d}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--gap", type=float, default=0.45, help="silence after each segment (s)")
    args = ap.parse_args()
    cfg = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
    k = Kokoro(f"{args.model_dir}/kokoro-v1.0.onnx", f"{args.model_dir}/voices-v1.0.bin")
    out_dir = HERE / "audio"
    out_dir.mkdir(exist_ok=True)
    timings, t, srt, sr_all, full = [], 0.0, [], None, []
    for i, seg in enumerate(cfg["segments"], 1):
        samples, sr = k.create(seg["text"], voice=cfg["voice"], speed=cfg["speed"], lang="en-us")
        sr_all = sr
        samples = np.asarray(samples, dtype=np.float32)
        sf.write(out_dir / f"{seg['id']}.wav", samples, sr)
        dur = len(samples) / sr
        timings.append({"id": seg["id"], "start": round(t, 3), "duration": round(dur, 3), "text": seg["text"]})
        # split long captions into ~2 lines by sentence
        sentences = [x.strip() for x in seg["text"].replace(": ", ". ").split(". ") if x.strip()]
        per = dur / max(1, len(sentences))
        for j, sent in enumerate(sentences):
            a, b = t + j * per, t + (j + 1) * per
            srt.append(f"{len(srt) + 1}\n{srt_time(a)} --> {srt_time(b)}\n{sent.rstrip('.')}{'.' if not sent.endswith(('.', '?', '!')) else ''}\n")
        full.append(samples)
        full.append(np.zeros(int(args.gap * sr), dtype=np.float32))
        t += dur + args.gap
    sf.write(out_dir / "narration_full.wav", np.concatenate(full), sr_all)
    (HERE / "timings.json").write_text(json.dumps({"total": round(t, 3), "segments": timings}, indent=2), encoding="utf-8")
    (HERE / "captions.srt").write_text("\n".join(srt), encoding="utf-8")
    print(f"total narration {t:.1f}s across {len(timings)} segments")
    for x in timings:
        print(f"  {x['id']:14s} {x['start']:6.1f}s  +{x['duration']:.1f}s")


if __name__ == "__main__":
    main()
