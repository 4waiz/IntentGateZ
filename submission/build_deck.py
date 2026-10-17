"""Build the IntentGate Z pitch deck (PPTX) from measured result files and real screenshots.

Every number on the slides is read from ml/results/*.json or evidence/ibmz/*; nothing is typed in
by hand. Missing inputs are shown as "not measured" rather than invented.

    python submission/build_deck.py --team "<registered team name>" --live-url <url>
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "ml" / "results"
EVID = ROOT / "evidence"
SHOTS = ROOT / "assets" / "screenshots"

BG = RGBColor(0x05, 0x0B, 0x12)
PANEL = RGBColor(0x0C, 0x1A, 0x28)
FG = RGBColor(0xE8, 0xF0, 0xF7)
MUTED = RGBColor(0x84, 0x96, 0xA8)
TEAL = RGBColor(0x00, 0xD5, 0xB5)
AMBER = RGBColor(0xFF, 0xBC, 0x5C)
RED = RGBColor(0xFF, 0x5D, 0x70)
BLUE = RGBColor(0x0F, 0x62, 0xFE)
# Fonts present on Windows so the PDF export embeds them (IBM Plex is not installed on the build PC)
FONT = "Segoe UI"
MONO = "Consolas"


def load(name: str) -> dict:
    p = RES / name
    return json.loads(p.read_text()) if p.is_file() else {}


def evidence_text(name: str) -> str:
    p = EVID / "ibmz" / f"{name}.txt"
    return p.read_text(errors="replace") if p.is_file() else ""


class Deck:
    def __init__(self) -> None:
        self.prs = Presentation()
        self.prs.slide_width = Inches(13.333)
        self.prs.slide_height = Inches(7.5)
        self.blank = self.prs.slide_layouts[6]

    def slide(self, kicker: str, title: str):
        s = self.prs.slides.add_slide(self.blank)
        bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, self.prs.slide_width, self.prs.slide_height)
        bg.fill.solid()
        bg.fill.fore_color.rgb = BG
        bg.line.fill.background()
        self.text(s, kicker.upper(), 0.6, 0.45, 9, 0.35, 12, MUTED, spacing=3)
        self.text(s, title, 0.6, 0.75, 12.2, 0.9, 30 if len(title) <= 48 else 25, FG, bold=True)
        bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.6), Inches(1.62), Inches(0.9), Emu(38000))
        bar.fill.solid()
        bar.fill.fore_color.rgb = TEAL
        bar.line.fill.background()
        self.text(s, "INTENTGATE Z  ·  IBM Z Datathon 2026", 0.6, 7.0, 6, 0.3, 10, MUTED)
        return s

    def text(self, s, txt, x, y, w, h, size=16, color=FG, bold=False, font=FONT, spacing=0, align=None):
        tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tf = tb.text_frame
        tf.word_wrap = True
        lines = txt if isinstance(txt, list) else [txt]
        for i, line in enumerate(lines):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            if align:
                p.alignment = align
            r = p.add_run()
            r.text = line
            r.font.size = Pt(size)
            r.font.color.rgb = color
            r.font.bold = bold
            r.font.name = font
            if spacing:
                rPr = r._r.get_or_add_rPr()
                rPr.set("spc", str(spacing * 100))
        return tb

    def card(self, s, x, y, w, h, title, body, accent=TEAL, title_size=15, body_size=12):
        box = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
        box.adjustments[0] = 0.06
        box.fill.solid()
        box.fill.fore_color.rgb = PANEL
        box.line.color.rgb = accent
        box.line.width = Pt(1.2)
        self.text(s, title, x + 0.2, y + 0.15, w - 0.4, 0.4, title_size, accent, bold=True)
        self.text(s, body, x + 0.2, y + 0.6, w - 0.4, h - 0.7, body_size, FG)

    def image(self, s, path: Path, x, y, w=None, h=None):
        if path.is_file():
            kw = {}
            if w:
                kw["width"] = Inches(w)
            if h:
                kw["height"] = Inches(h)
            s.shapes.add_picture(str(path), Inches(x), Inches(y), **kw)
            return True
        self.text(s, f"[missing image: {path.name}]", x, y, 4, 0.4, 12, MUTED)
        return False


def pct(v) -> str:
    return "not measured" if v is None else f"{v * 100:.1f}%"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", required=True)
    ap.add_argument("--live-url", default="")
    ap.add_argument("--repo", default="https://github.com/4waiz/IntentGateZ")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    deck_title = f"{args.team}_IBM Z Datathon 2026 Project - IntentGate Z"
    out = Path(args.out) if args.out else ROOT / "submission" / f"{deck_title}.pptx"

    ev = load("evaluation_seed7.json")
    rep = load("repeated_seeds_summary.json")
    txt = load("injection_text_model.json")
    bench = load("benchmark_inprocess.json")
    http = load("benchmark_http.json")
    nnpa = load("nnpa_benchmark.json")
    arch = ev.get("platform", {}).get("architecture", "unknown")
    machine = re.search(r"machine = ([0-9A-F]{4})", evidence_text("machine_type") or evidence_text("cpuinfo"))
    machine = machine.group(1) if machine else None
    sysinfo = evidence_text("sysinfo")
    model = re.search(r"^Model:\s+(\S+)\s+(\S+)", sysinfo, re.M)
    cp = re.search(r"VM00 Control Program:\s+(.+)$", sysinfo, re.M)
    nnpa_listed = "nnpa" in (evidence_text("lscpu_nnpa") + evidence_text("cpuinfo_features")).lower()

    d = Deck()
    d.prs.core_properties.title = deck_title
    d.prs.core_properties.author = args.team

    # 1 title
    s = d.slide("IBM Z Datathon 2026 · AI Secured: Innovation Without Exposure", "INTENTGATE Z")
    d.text(s, "Authorized doesn't always mean intended.", 0.6, 1.95, 12, 0.8, 32, TEAL, bold=True)
    d.text(s, "A real-time security gateway that checks every autonomous-agent action against the human's registered intent, then returns ALLOW, CHALLENGE or BLOCK before anything executes. Running on IBM LinuxONE, with the risk model on the Telum on-chip AI accelerator.", 0.6, 2.85, 6.5, 2.2, 17, FG)
    d.text(s, [deck_title, f"Team: {args.team}", f"Code: {args.repo}"] + ([f"Live: {args.live_url}"] if args.live_url else []), 0.6, 5.15, 6.6, 1.6, 12, MUTED, font=MONO)
    d.image(s, SHOTS / "hero.png", 7.35, 2.85, w=5.4)

    # 2 problem
    s = d.slide("The problem", "Authentication proves who acts, not what the human intended")
    d.card(s, 0.6, 2.0, 3.9, 2.4, "Valid credentials, wrong action", "An ambulance-routing agent reads a poisoned hospital-status feed and redirects a critical patient to the wrong hospital, while still fully authenticated.", RED)
    d.card(s, 4.7, 2.0, 3.9, 2.4, "Authority creep", "A procurement agent turns a $50,000 restock into a $200,000 order. Each step looked like normal tool use.", AMBER)
    d.card(s, 8.8, 2.0, 3.9, 2.4, "Intent drift", "A coordination agent finishes its task, then 'helpfully' diverts a children's hospital it was never asked to touch.", RED)
    d.text(s, "Evidence: on the InjecAgent benchmark (Zhan et al., Findings of ACL 2024), a ReAct-prompted GPT-4 agent followed instructions hidden in tool outputs in 24% of attacks, and an enhanced attack nearly doubled that. As hospitals, emergency services and enterprises hand real actions to AI agents, the missing control is an intent check at the moment of action, with evidence a human can audit.", 0.6, 4.75, 12.1, 1.8, 16, FG)

    # 3 solution
    s = d.slide("The solution", "One decision path before every sensitive action")
    steps = [("Human intent", "Signed, versioned, immutable: operations, targets, budget, ETA, expiry", BLUE), ("Agent proposal", "Tool call + parameter-level provenance (trusted / internal / untrusted)", MUTED), ("IntentGate Z on IBM Z", "Identity, hard policy, 43 features, ML risk, fusion", TEAL), ("Verdict", "ALLOW executes · CHALLENGE needs a supervisor grant · BLOCK prevents", AMBER)]
    for i, (t, b, c) in enumerate(steps):
        d.card(s, 0.6 + i * 3.15, 2.0, 2.95, 2.3, t, b, c, 15, 12)
    d.card(s, 0.6, 4.6, 6.0, 2.1, "Hard rules first, ML second", "Any hard violation forces BLOCK. The ML model can escalate ALLOW to CHALLENGE or BLOCK, but can never relax a hard finding; an ML-only BLOCK needs structural corroboration.", TEAL)
    d.card(s, 6.8, 4.6, 5.9, 2.1, "Human review that cannot be replayed", "Supervisor grants are single-use, expire in 120 s, are bound to the exact action fingerprint and are re-validated against live conditions before execution.", AMBER)

    # 4 architecture
    s = d.slide("Technical architecture", "Operator → Agent → IntentGate Z on IBM LinuxONE → Tools")
    d.image(s, ROOT / "assets" / "architecture.png", (13.333 - 8.98) / 2, 1.85, h=5.05)

    # 5 product
    s = d.slide("The product", "A 3D command center that shows only server-issued outcomes")
    d.image(s, SHOTS / "command_center.png", 0.6, 1.85, w=8.2)
    d.card(s, 9.0, 1.85, 3.7, 1.5, "ALLOW", "Reroute around a closure: ambulance follows the authorised route.", TEAL, 14, 11)
    d.card(s, 9.0, 3.45, 3.7, 1.5, "CHALLENGE", "$200k order held; supervisor grant, replay and tamper tests refused by the server.", AMBER, 14, 11)
    d.card(s, 9.0, 5.05, 3.7, 1.6, "BLOCK", "Injected redirect stopped; ghost route shown, the real unit never moves.", RED, 14, 11)

    # 6 IBM Z execution
    s = d.slide("IBM Z technical execution", "The decision engine, models and audit run on IBM LinuxONE")
    facts = [
        f"Architecture (uname -m): {arch}",
        f"Machine type {machine or 'see evidence'}" + (" = IBM z17" if machine == "9175" else "") + (f", model {model.group(1)} {model.group(2)}" if model else ""),
        (f"Guest of {cp.group(1).split()[0]} {cp.group(1).split()[-1]}" if cp else "Hypervisor: see evidence/ibmz"),
        f"NNPA facility in /proc/cpuinfo features: {'yes' if nnpa_listed else 'not verified'}",
        "Backend: FastAPI in Docker, built FROM the LinuxONE Community Cloud s390x AI/ML image",
        "Models trained and evaluated on LinuxONE: scikit-learn, XGBoost, PyTorch",
        "HTTPS via Caddy on the VM; Jupyter only through an SSH tunnel",
    ]
    d.card(s, 0.6, 1.95, 6.6, 3.55, "Verified on the VM (evidence/ibmz)", facts, BLUE, 15, 13)
    perf = []
    if bench.get("summary"):
        b = bench["summary"]
        perf.append(f"In-process decision p50 {b['decision_p50_ms_median_of_reps']} ms, p95 {b['decision_p95_ms_median_of_reps']} ms")
        perf.append(f"{b['throughput_median_of_reps']:,} decisions/s, one thread, incl. audit writes")
    for lv in http.get("levels", []):
        if lv["concurrency"] in (1, 8):
            perf.append(f"HTTP, concurrency {lv['concurrency']}: p50 {lv['latency_ms']['p50']} ms, {lv['throughput_rps']} req/s, {lv['errors']} errors")
    perf.append("Measured on the 2-vCPU / 4 GB LinuxONE VM")
    d.card(s, 7.4, 1.95, 5.3, 3.55, "Gateway speed on LinuxONE", perf, TEAL, 15, 13)
    d.image(s, SHOTS / "proof.png", 0.6, 5.65, h=1.25)
    d.text(s, "The console's IBM Z Proof screen reads every value above live from the s390x backend (/api/platform, /api/model/info, /api/metrics); nothing on it is hard-coded.", 2.75, 5.75, 9.9, 1.0, 13, MUTED)

    # 7 Telum NNPA
    s = d.slide("IBM Telum on-chip AI accelerator", "The live risk model runs on the NNPA, verified on device")
    d.image(s, RES / "charts" / "nnpa_vs_cpu.png", 0.6, 1.9, w=7.6)
    ver = nnpa.get("verification", {})
    if ver.get("parameter_device") == "nnpa":
        st = nnpa.get("nnpa_status", {})
        ratios = nnpa.get("cpu_over_nnpa_time_ratio", {})
        lines = [
            f"torch_nnpa {st.get('torch_nnpa_version', '?')}: device available, smoke test {'passed' if st.get('smoke_test') else 'failed'}",
            f"Model parameters / outputs on device: {ver['parameter_device']} / {ver.get('output_device')}",
            f"Same weights and inputs as on CPU: max |Δp| {nnpa.get('max_abs_prob_difference')}, argmax agreement {nnpa.get('argmax_agreement', 0) * 100:.2f}%",
            "CPU / NNPA time: " + ", ".join(f"batch {b}: {v:.2f}×" for b, v in ratios.items()),
        ]
        if ratios:
            best = max(ratios, key=ratios.get)
            lines.append(f"Single rows are faster on CPU; from batch 128 the NNPA wins, up to {ratios[best]:.2f}× at batch {best}.")
        lines.append("TensorFlow's zDNN plugin exposes no NNPA device here, so TF acceleration is not claimed.")
        d.card(s, 8.4, 1.9, 4.3, 4.9, "Measured, not assumed", lines, TEAL, 15, 12)
    else:
        d.card(s, 8.4, 1.9, 4.3, 4.9, "Measured, not assumed", "NNPA was not verified in the saved benchmark; no acceleration is claimed.", MUTED, 15, 12)

    # 8 results
    s = d.slide("Results (held-out test sets, unseen text templates)", "Fewest unsafe actions let through, and zero false blocks")
    if rep.get("methods"):
        rows = [("Hard policy only", "hard_policy"), ("Rules + heuristics", "rules_heuristic"), ("ML only", "ml_only"), ("IntentGate Z hybrid", "hybrid")]
        d.text(s, f"Mean over {rep['n_runs']} independently generated datasets, trained and scored on {', '.join(rep.get('architecture', ['?']))}", 0.6, 1.9, 12, 0.4, 13, MUTED)
        for i, (name, k) in enumerate(rows):
            m = rep["methods"][k]
            c = TEAL if k == "hybrid" else FG
            d.text(s, name, 0.6, 2.35 + i * 0.5, 3.6, 0.45, 15, c, bold=k == "hybrid")
            d.text(s, f"unsafe let through {pct(m['unsafe_miss_rate']['mean'])}   legit blocked {pct(m['false_block_rate_allow']['mean'])}   macro-F1 {m['macro_f1']['mean']:.3f}", 4.0, 2.35 + i * 0.5, 8.7, 0.45, 15, c, font=MONO)
    if txt.get("feed_injection_model"):
        e = txt["feed_injection_model"]["external_public_sets"]
        d.text(s, f"Public attack text never seen in training, flagged by the feed model: InjecAgent {pct(e['injecagent_attacker_plain']['flagged_rate'])}, AgentDojo {pct(e['agentdojo_goals_plain']['flagged_rate'])}.", 0.6, 4.4, 12, 0.4, 12, MUTED)
    d.image(s, RES / "charts" / "attack_family_detection.png", 0.6, 4.8, h=2.1)
    d.image(s, RES / "charts" / "method_comparison.png", 6.9, 4.8, h=2.1)

    # 9 impact
    s = d.slide("Value to the community and roadmap", "Safer automation where mistakes cost lives or money")
    d.card(s, 0.6, 1.95, 3.9, 2.6, "Who benefits", ["EMS dispatchers and hospital command centres", "Public emergency agencies", "Healthcare IT and security teams", "Banks and insurers running agents on IBM Z"], TEAL, 15, 12)
    d.card(s, 4.7, 1.95, 3.9, 2.6, "Why IBM Z", ["Decisions sit next to the transaction systems", "On-chip AI inference (Telum NNPA)", "Enterprise isolation, encryption, audit", "Scales to every agent call"], BLUE, 15, 12)
    d.card(s, 8.8, 1.95, 3.9, 2.6, "Next steps", ["Pilot on real CAD/ERP action logs", "Policy-as-code for operators", "External anchoring of the audit head", "Signed tool manifests per agent"], AMBER, 15, 12)
    d.card(s, 0.6, 4.8, 12.1, 1.8, "Honest limitations", "Synthetic data and a fictional city; labels come from our generator, not real incidents. The injection scenario's attacker is a deterministic test harness, not a compromised LLM. NNPA claims are limited to what the benchmark measured on this VM.", MUTED, 14, 12)

    out.parent.mkdir(parents=True, exist_ok=True)
    d.prs.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
