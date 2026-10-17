"""Aggregate repeated evaluations (one per independently generated dataset seed) into mean +/- std."""

from __future__ import annotations

import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "ml" / "results"
METHODS = ["hard_policy", "rules_heuristic", "ml_only", "hybrid"]
METRICS = ["macro_f1", "accuracy", "unsafe_miss_rate", "false_block_rate_allow", "legit_acceptance_rate", "challenge_rate"]


def main() -> None:
    runs = {}
    for p in sorted(RES.glob("evaluation_seed*.json")):
        r = json.loads(p.read_text())
        runs[r["seed"]] = r
    if not runs:
        raise SystemExit("no evaluation_seed*.json files found")
    out = {"seeds": sorted(runs), "n_runs": len(runs), "selected_models": {s: r["selected_model"] for s, r in runs.items()}, "architecture": sorted({r["platform"]["architecture"] for r in runs.values()}), "methods": {}}
    for m in METHODS:
        out["methods"][m] = {}
        for k in METRICS:
            vals = [r["test"][m][k] for r in runs.values() if r["test"][m].get(k) is not None]
            out["methods"][m][k] = {"mean": round(statistics.mean(vals), 4), "std": round(statistics.stdev(vals), 4) if len(vals) > 1 else 0.0, "min": round(min(vals), 4), "max": round(max(vals), 4), "values": vals}
    (RES / "repeated_seeds_summary.json").write_text(json.dumps(out, indent=2))
    for m in METHODS:
        f = out["methods"][m]["macro_f1"]
        u = out["methods"][m]["unsafe_miss_rate"]
        print(f"{m:16s} macro-F1 {f['mean']:.4f} +/- {f['std']:.4f}   unsafe-miss {u['mean']:.4f} +/- {u['std']:.4f}   (n={len(f['values'])})")


if __name__ == "__main__":
    main()
