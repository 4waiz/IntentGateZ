"""CPU vs IBM Telum NNPA inference benchmark for the Keras risk MLP.

TensorFlow on IBM z16/z17 with `ibm-zdnn-plugin` places supported ops on the NNPA device unless
`NNPA_DEVICES=0` is set before TensorFlow is imported. A fair comparison therefore needs two
separate processes. This script launches itself twice (child mode) and compares:

    python ml/benchmark_nnpa.py            # parent: runs both children, writes results
    NNPA_DEVICES=0 python ml/benchmark_nnpa.py --child cpu

Each child reports the TensorFlow physical device list, so the report states whether NNPA was
actually visible in that process. Results: ml/results/nnpa_benchmark.json
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCHES = [1, 16, 128, 1024, 8192]


def child(label: str, reps: int) -> dict:
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    import numpy as np
    import tensorflow as tf

    meta = json.loads((ROOT / "ml" / "artifacts" / "model_meta.json").read_text())
    model = tf.keras.models.load_model(ROOT / "ml" / "artifacts" / meta["artifacts"]["keras"], compile=False)
    devices = [d.name for d in tf.config.list_physical_devices()]
    import importlib.metadata as md

    try:
        plugin = md.version("ibm-zdnn-plugin")
    except md.PackageNotFoundError:
        plugin = None
    rng = np.random.default_rng(0)
    nfeat = len(meta["feature_names"])
    fn = tf.function(lambda x: model(x, training=False), reduce_retracing=True)
    out = {"label": label, "tf_version": tf.__version__, "ibm_zdnn_plugin": plugin, "physical_devices": devices, "nnpa_visible": any("NNPA" in d for d in devices), "NNPA_DEVICES": os.environ.get("NNPA_DEVICES"), "batches": {}}
    ref = None
    for b in BATCHES:
        x = tf.constant(rng.normal(size=(b, nfeat)).astype("float32"))
        for _ in range(3):
            y = fn(x).numpy()
        if b == 1024:
            ref = y[:8].round(5).tolist()
        times = []
        for _ in range(reps):
            t0 = time.perf_counter()
            fn(x).numpy()
            times.append((time.perf_counter() - t0) * 1000)
        times.sort()
        med = times[len(times) // 2]
        out["batches"][str(b)] = {"median_ms": round(med, 4), "best_ms": round(times[0], 4), "rows_per_s": round(b / (med / 1000), 1), "reps": reps}
    out["sample_outputs_batch1024"] = ref
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--child", choices=["cpu", "nnpa"], default=None)
    ap.add_argument("--reps", type=int, default=30)
    args = ap.parse_args()
    if args.child:
        print("RESULT " + json.dumps(child(args.child, args.reps)))
        return
    runs = {}
    for label, env_val in (("cpu", "0"), ("nnpa", None)):
        env = dict(os.environ)
        if env_val is None:
            env.pop("NNPA_DEVICES", None)
        else:
            env["NNPA_DEVICES"] = env_val
        p = subprocess.run([sys.executable, __file__, "--child", label, "--reps", str(args.reps)], env=env, capture_output=True, text=True, timeout=1800)
        line = next((ln for ln in p.stdout.splitlines() if ln.startswith("RESULT ")), None)
        runs[label] = json.loads(line[7:]) if line else {"error": p.stderr[-2000:]}
    speedup = {}
    if "batches" in runs.get("cpu", {}) and "batches" in runs.get("nnpa", {}):
        for b in runs["cpu"]["batches"]:
            c, n = runs["cpu"]["batches"][b]["median_ms"], runs["nnpa"]["batches"][b]["median_ms"]
            speedup[b] = round(c / n, 3) if n > 0 else None
    import numpy as np

    agree = None
    if runs.get("cpu", {}).get("sample_outputs_batch1024") and runs.get("nnpa", {}).get("sample_outputs_batch1024"):
        a = np.asarray(runs["cpu"]["sample_outputs_batch1024"])
        b = np.asarray(runs["nnpa"]["sample_outputs_batch1024"])
        agree = round(float(np.abs(a - b).max()), 5)
    res = {
        "what": "Keras risk MLP inference, same model and inputs, two processes (NNPA_DEVICES=0 vs default)",
        "host": {"architecture": platform.machine(), "python": platform.python_version(), "cpu_count": os.cpu_count()},
        "runs": runs,
        "speedup_cpu_over_nnpa_median": speedup,
        "max_abs_output_difference": agree,
        "interpretation": "Speed-up > 1 means the NNPA process was faster. NNPA is counted as used only if nnpa_visible is true in that process.",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (ROOT / "ml" / "results").mkdir(parents=True, exist_ok=True)
    (ROOT / "ml" / "results" / "nnpa_benchmark.json").write_text(json.dumps(res, indent=2))
    print(json.dumps({"speedup": speedup, "nnpa_visible": runs.get("nnpa", {}).get("nnpa_visible"), "cpu_visible_nnpa": runs.get("cpu", {}).get("nnpa_visible"), "max_abs_diff": agree}, indent=2))


if __name__ == "__main__":
    main()
