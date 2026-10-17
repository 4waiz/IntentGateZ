"""Render README.md from submission/README.template.md and the measured result files.

    python submission/render_readme.py --team "<team>" --live-url <url> --video-url <url>
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "ml" / "results"


def j(name: str) -> dict:
    p = RES / name
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


def ev_text(name: str) -> str:
    p = ROOT / "evidence" / "ibmz" / f"{name}.txt"
    return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else ""


def pct(v, d=1) -> str:
    return "n/a" if v is None else f"{v * 100:.{d}f}%"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", required=True)
    ap.add_argument("--live-url", required=True)
    ap.add_argument("--video-url", default="submission/IntentGateZ_Demo.mp4")
    args = ap.parse_args()

    ev = j("evaluation_seed7.json")
    rep = j("repeated_seeds_summary.json")
    txt = j("injection_text_model.json")
    nn = j("nnpa_benchmark.json")
    bi = j("benchmark_inprocess.json")
    bh = j("benchmark_http.json")
    tpl = (ROOT / "submission" / "README.template.md").read_text(encoding="utf-8")

    lscpu = ev_text("lscpu")
    sysinfo = ev_text("sysinfo")
    get = lambda pat, s: (re.search(pat, s).group(1).strip() if re.search(pat, s) else "n/a")  # noqa: E731
    facts = [
        "| Fact (captured over SSH, see `evidence/ibmz/`) | Value |",
        "|---|---|",
        f"| `uname -m` | `{ev_text('uname_m').splitlines()[-1].strip() if ev_text('uname_m') else 'n/a'}` |",
        f"| Machine type (`lscpu`, `/proc/sysinfo`) | `{get(r'Machine type:\s+(\S+)', lscpu)}` (IBM z17), model `{get(r'Model:\s+(.+)', sysinfo)}` |",
        f"| Hypervisor | `{get(r'Hypervisor:\s+(.+)', lscpu)}` |",
        f"| CPU flags include `nnpa` (Telum on-chip AI accelerator facility) | `{'yes' if 'nnpa' in ev_text('lscpu_nnpa') else 'no'}` |",
        f"| vCPUs / RAM | `{get(r'^CPU\(s\):\s+(\d+)', lscpu)}` / `{get(r'Mem:\s+(\S+)', ev_text('memory'))}` |",
        f"| OS | `{get(r'PRETTY_NAME=\"?([^\"]+)', ev_text('os_release'))}` |",
    ]
    nnpa_sentence = "Not measured."
    if nn.get("cpu_over_nnpa_time_ratio"):
        r = nn["cpu_over_nnpa_time_ratio"]
        best_b = max(r, key=lambda b: r[b])
        nnpa_sentence = (
            f"The live risk model is a PyTorch MLP moved to the `nnpa` device with IBM's `torch_nnpa`; the API verifies on start-up that its parameters live on the NNPA and that its outputs match the CPU model. "
            f"Measured on the VM: NNPA is **{r[best_b]:.2f}x faster than the CPU at batch {best_b}** (ratios by batch: {', '.join(f'{b}: {v}' for b, v in r.items())}; slower than CPU for a single row), "
            f"max probability difference vs CPU {nn.get('max_abs_prob_difference')}, identical decisions on {pct(nn.get('argmax_agreement'), 2)} of rows. "
            "TensorFlow's `ibm-zdnn-plugin` is present in the image but exposes no separate NNPA device, so no TensorFlow acceleration is claimed."
        )
    ds = ev.get("dataset", {})
    dataset_sentence = f"{ds.get('rows', 'n/a'):,} synthetic proposals per dataset (train {ds.get('train')}, validation {ds.get('val')}, test {ds.get('test')}), generated with documented rules and fixed seeds by [ml/generate_dataset.py](ml/generate_dataset.py); five independently seeded datasets were used for repeated runs."
    cands = ", ".join(ev.get("validation", {}).get("models", {}).keys())

    rows = [("Hard policy only", "hard_policy"), ("Rules + heuristics", "rules_heuristic"), ("ML only (pure model)", "ml_only"), ("**IntentGate Z hybrid**", "hybrid")]
    table = ["| Method (held-out test, unseen templates) | Unsafe actions that would execute | Legit actions wrongly blocked | Legit actions allowed straight through | Sent to human review | Macro-F1 (exact verdict) |", "|---|---|---|---|---|---|"]
    for name, k in rows:
        if rep.get("methods"):
            m = rep["methods"][k]
            f = lambda key: f"{m[key]['mean'] * 100:.1f}% ± {m[key]['std'] * 100:.1f}"  # noqa: E731
            table.append(f"| {name} | {f('unsafe_miss_rate')} | {f('false_block_rate_allow')} | {f('legit_acceptance_rate')} | {f('challenge_rate')} | {m['macro_f1']['mean']:.3f} ± {m['macro_f1']['std']:.3f} |")
    extra = []
    if rep.get("methods"):
        extra.append(f"Mean ± standard deviation over **{rep['n_runs']} independently generated datasets** (seeds {', '.join(map(str, rep['seeds']))}), each with its own train/validation/test split, all run on LinuxONE. The serving model selected in every run: {', '.join(sorted(set(rep['selected_models'].values())))}.")
    if ev:
        fam = ev["test"]["hybrid"]["families"].get("reroute:injected_in_scope")
        hfam = ev["test"]["hard_policy"]["families"].get("reroute:injected_in_scope")
        if fam and hfam:
            extra.append(f"Where the ML layer matters most: injections that steer the agent to a *permitted but wrong* hospital. Hard policy alone allows {pct(hfam['pred_allow'])} of them; the hybrid allows {pct(fam['pred_allow'])} (seed 7 test set).")
        extra.append(f"Trade-off: the hybrid sends more borderline legitimate actions to a human (allowed straight through: hybrid {pct(rep['methods']['hybrid']['legit_acceptance_rate']['mean'])} vs rules {pct(rep['methods']['rules_heuristic']['legit_acceptance_rate']['mean'])}) in exchange for far fewer unsafe executions and no false blocks. Macro-F1 counts CHALLENGE-instead-of-BLOCK as an error even though the action is stopped, which is why it is similar across methods.")
        cal = ev.get("calibration", {})
        extra.append(f"Calibration of the served model's P(BLOCK) on test: ECE {cal.get('p_block_ece_10bin')} (10 bins), multiclass Brier {cal.get('multiclass_brier')}. Risk scores are presented as model scores, not as calibrated probabilities.")
        extra.append("**Design iteration, disclosed:** the first fusion let the ML model block on its own. Error analysis of its test errors showed 7% of legitimate actions blocked because one unseen benign template (\"System notice: …\") looked like an injection. The fusion was changed so an ML-driven BLOCK needs structural corroboration; thresholds are still chosen on validation only. v1 results are kept in [ml/results/v1_ml_can_block_alone](ml/results/v1_ml_can_block_alone).")
    if txt.get("feed_injection_model"):
        e = txt["feed_injection_model"]["external_public_sets"]
        extra.append(f"Public attack text never seen in training (feed model): InjecAgent attacker instructions flagged {pct(e['injecagent_attacker_plain']['flagged_rate'])} (with the benchmark's \"enhanced\" prefix {pct(e['injecagent_attacker_enhanced']['flagged_rate'])}), AgentDojo injection goals {pct(e['agentdojo_goals_plain']['flagged_rate'])} (wrapped in its attack template {pct(e['agentdojo_important_instructions']['flagged_rate'])}). Benign InjecAgent user requests are flagged {pct(e['injecagent_user_instructions_benign']['flagged_rate'])}: on an untrusted channel any instruction to the agent is suspicious, which is why the score is applied only to untrusted text.")
    if bi.get("summary"):
        s = bi["summary"]
        extra.append(f"Gateway speed on LinuxONE (in-process, single thread, including SQLite audit writes and simulator execution): decision p50 **{s['decision_p50_ms_median_of_reps']} ms**, p95 {s['decision_p95_ms_median_of_reps']} ms, **{s['throughput_median_of_reps']:,} decisions/s** ({bi.get('model_runtime')}).")
    if bh.get("levels"):
        lv = bh["levels"]
        extra.append("HTTP load on the VM (single uvicorn worker): " + "; ".join(f"concurrency {x['concurrency']}: {x['throughput_rps']} req/s, p50 {x['latency_ms']['p50']} ms, p95 {x['latency_ms']['p95']} ms, {x['errors']} errors" for x in lv) + ".")

    shots = []
    for f, cap in [("hero.png", "Command center"), ("block.png", "BLOCK: injected redirect stopped, ghost route only"), ("challenge.png", "CHALLENGE: supervisor grant, replay rejected"), ("proof.png", "IBM Z Proof screen (live data from the s390x backend)")]:
        if (ROOT / "assets" / "screenshots" / f).is_file():
            shots.append(f"<img src=\"assets/screenshots/{f}\" alt=\"{cap}\" width=\"49%\"/>")
    shots_md = "<p align=\"center\">" + " ".join(shots) + "</p>" if shots else "_Screenshots: see the live demo._"

    out = (
        tpl.replace("{{LIVE_URL}}", args.live_url)
        .replace("{{VIDEO_URL}}", args.video_url)
        .replace("{{TEAM}}", args.team)
        .replace("{{SCREENSHOTS}}", shots_md)
        .replace("{{IBMZ_FACTS}}", "\n".join(facts))
        .replace("{{NNPA_SENTENCE}}", nnpa_sentence)
        .replace("{{DATASET_SENTENCE}}", dataset_sentence)
        .replace("{{CANDIDATES}}", cands)
        .replace("{{RESULTS_ARCH}}", f"IBM LinuxONE ({ev.get('platform', {}).get('architecture', 'n/a')})")
        .replace("{{RESULTS_TABLE}}", "\n".join(table))
        .replace("{{RESULTS_EXTRA}}", "\n\n".join(f"* {x}" for x in extra))
        .replace("{{FLAVOR_NOTE}}", "The team's server uses the standard 2-vCPU / 4 GB LinuxONE flavor (the larger AI-lab flavor was not offered on this account); all numbers above were measured on it.")
    )
    assert "{{" not in out, re.findall(r"\{\{\w+\}\}", out)
    (ROOT / "README.md").write_text(out, encoding="utf-8")
    print("README.md written,", len(out), "chars")


if __name__ == "__main__":
    main()
