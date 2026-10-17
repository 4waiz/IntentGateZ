"""CPU vs IBM Telum NNPA inference benchmark for the PyTorch risk MLP (IBM torch_nnpa).

Same trained model, same inputs, same process: run on device "cpu", then on device "nnpa".
Reports median latency per batch size, rows/s, the CPU/NNPA time ratio, and the maximum
absolute difference between CPU and NNPA probabilities (NNPA computes in reduced precision).
NNPA is reported as used only when torch_nnpa reports the device available and the model's
parameters and outputs are verified to live on it.

    python ml/benchmark_nnpa.py --reps 30
Results: ml/results/nnpa_benchmark.json
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from intentgate.torch_mlp import TorchRisk, nnpa_status  # noqa: E402

BATCHES = [1, 16, 128, 1024, 8192]


def bench(model: TorchRisk, X: np.ndarray, reps: int) -> dict:
    out = {}
    for b in BATCHES:
        xb = X[np.arange(b) % len(X)]
        for _ in range(3):
            model.predict_proba(xb)
        ts = []
        for _ in range(reps):
            t0 = time.perf_counter()
            model.predict_proba(xb)
            ts.append((time.perf_counter() - t0) * 1000)
        ts.sort()
        med = ts[len(ts) // 2]
        out[str(b)] = {"median_ms": round(med, 4), "p95_ms": round(ts[int(len(ts) * 0.95) - 1], 4), "rows_per_s": round(b / (med / 1000), 1), "reps": reps}
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=30)
    args = ap.parse_args()
    import pandas as pd
    import torch

    meta = json.loads((ROOT / "ml" / "artifacts" / "model_meta.json").read_text())
    path = ROOT / "ml" / "artifacts" / meta["artifacts"]["torch"]
    df = pd.read_csv(ROOT / "datasets" / "intentgate_synthetic_seed7.csv")
    X = df[df.split == "test"][meta["feature_names"]].to_numpy(dtype=np.float32)

    status = nnpa_status()
    res = {"what": "PyTorch risk MLP (43-64-32-3) inference: identical weights and inputs on CPU and on the IBM Telum NNPA", "nnpa_status": status, "runs": {}}
    cpu = TorchRisk.load(path, "cpu")
    res["runs"]["cpu"] = bench(cpu, X, args.reps)
    p_cpu = cpu.predict_proba(X[:2048])
    if status.get("available"):
        npu = TorchRisk.load(path, "nnpa")
        param_dev = next(npu.model.parameters()).device.type
        with torch.inference_mode():
            xt = (torch.tensor(X[:4]) - npu.mean) / npu.scale
            out_dev = npu.model(xt.to("nnpa")).device.type
        res["verification"] = {"parameter_device": param_dev, "output_device": out_dev}
        res["runs"]["nnpa"] = bench(npu, X, args.reps)
        p_npu = npu.predict_proba(X[:2048])
        res["max_abs_prob_difference"] = round(float(np.abs(p_cpu - p_npu).max()), 6)
        res["argmax_agreement"] = round(float((p_cpu.argmax(1) == p_npu.argmax(1)).mean()), 6)
        res["cpu_over_nnpa_time_ratio"] = {b: round(res["runs"]["cpu"][b]["median_ms"] / res["runs"]["nnpa"][b]["median_ms"], 3) for b in res["runs"]["cpu"]}
    else:
        res["verification"] = {"note": "NNPA not available in this process; only CPU measured"}
    try:
        import importlib.metadata as md

        res["tensorflow_zdnn_plugin"] = {"version": md.version("ibm-zdnn-plugin"), "note": "installed as kernel overrides (_z_ops.so); TensorFlow lists no separate NNPA device, so TF acceleration is not claimed"}
    except Exception:
        pass
    res["host"] = {"architecture": platform.machine(), "python": platform.python_version(), "cpu_count": os.cpu_count(), "torch": torch.__version__}
    res["interpretation"] = "ratio > 1 means the NNPA run was faster for that batch size"
    res["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    (ROOT / "ml" / "results").mkdir(parents=True, exist_ok=True)
    (ROOT / "ml" / "results" / "nnpa_benchmark.json").write_text(json.dumps(res, indent=2))
    print(json.dumps({k: res.get(k) for k in ("nnpa_status", "verification", "cpu_over_nnpa_time_ratio", "max_abs_prob_difference", "argmax_agreement")}, indent=2))


if __name__ == "__main__":
    main()
