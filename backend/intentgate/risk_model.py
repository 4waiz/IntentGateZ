"""Predictive risk model runtime.

Loads the model selected by `ml/train.py` (metadata in `ml/artifacts/model_meta.json`) and
serves single-action inference. Supported serving runtimes:

* ``sklearn``  - scikit-learn estimator serialised with joblib (CPU)
* ``xgboost``  - XGBoost booster in JSON format (CPU)
* ``torch``    - PyTorch MLP; on IBM z16/z17 with IBM's ``torch_nnpa`` the model is moved to the
  "nnpa" device (Telum on-chip AI accelerator) after a smoke test and a CPU cross-check.
* ``keras``    - Keras MLP via TensorFlow (kept for compatibility).

The runtime reports what actually loaded. NNPA is only reported as active when torch_nnpa reports
the device available, the model's parameters live on it and its outputs match the CPU model;
detection of the CPU facility alone is never treated as proof of acceleration.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from .features import FEATURE_NAMES
from .schemas import Verdict

CLASSES = ["ALLOW", "CHALLENGE", "BLOCK"]


class RiskModel:
    def __init__(self, artifacts_dir: Path) -> None:
        self.dir = Path(artifacts_dir)
        self.meta: dict[str, Any] = {}
        self.kind = "unavailable"
        self.runtime = "no model loaded"
        self.model: Any = None
        self.version = "none"
        self.accelerator: dict[str, Any] = {"device": "cpu", "nnpa_device_listed": False, "verified": False}
        self.thresholds = {"tau_block": 0.85, "tau_review": 0.5}
        self.inference_count = 0
        self.last_error: str | None = None
        self._lock = threading.Lock()
        self._count_lock = threading.Lock()
        self._load()

    # ------------------------------------------------------------------ loading
    def _load(self) -> None:
        meta_path = self.dir / "model_meta.json"
        if not meta_path.is_file():
            self.last_error = f"{meta_path.name} not found; run ml/train.py"
            return
        self.meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if self.meta.get("feature_names") != FEATURE_NAMES:
            self.last_error = "feature schema mismatch between model and gateway; retrain the model"
            self.meta = {}
            return
        self.thresholds = self.meta.get("thresholds", self.thresholds)
        self.version = self.meta.get("version", "unknown")
        preference = os.environ.get("INTENTGATE_RISK_RUNTIME", self.meta.get("serving_runtime", "sklearn"))
        order = [preference] + [k for k in ("sklearn", "xgboost", "torch", "keras") if k != preference]
        for kind in order:
            try:
                if self._try_load(kind):
                    return
            except Exception as exc:  # pragma: no cover - depends on platform packages
                self.last_error = f"{kind}: {exc.__class__.__name__}: {exc}"
        self.kind = "unavailable"

    def _try_load(self, kind: str) -> bool:
        files = self.meta.get("artifacts", {})
        if kind == "sklearn" and files.get("sklearn"):
            import joblib

            self.model = joblib.load(self.dir / files["sklearn"])
            self.kind = "sklearn"
            self.runtime = f"scikit-learn {self.meta.get('models', {}).get('sklearn', {}).get('name', 'estimator')} (CPU)"
            self.accelerator = {"device": "cpu", "nnpa_device_listed": False, "verified": False}
            return True
        if kind == "xgboost" and files.get("xgboost"):
            import xgboost as xgb

            booster = xgb.Booster()
            booster.load_model(str(self.dir / files["xgboost"]))
            self.model = booster
            self.kind = "xgboost"
            self.runtime = f"XGBoost {xgb.__version__} gbtree (CPU)"
            self.accelerator = {"device": "cpu", "nnpa_device_listed": False, "verified": False}
            return True
        if kind == "torch" and files.get("torch"):
            from .torch_mlp import TorchRisk, nnpa_status

            want = os.environ.get("INTENTGATE_TORCH_DEVICE", self.meta.get("torch_device", "nnpa"))
            status = nnpa_status() if want == "nnpa" else {"available": False}
            device = "nnpa" if (want == "nnpa" and status.get("available") and status.get("smoke_test")) else "cpu"
            model = TorchRisk.load(self.dir / files["torch"], device)
            probe = np.random.default_rng(0).normal(size=(64, len(FEATURE_NAMES))).astype(np.float32)
            diff = None
            if device == "nnpa":
                ref = TorchRisk.load(self.dir / files["torch"], "cpu").predict_proba(probe)
                diff = float(np.abs(model.predict_proba(probe) - ref).max())
            param_device = next(model.model.parameters()).device.type
            self.model = model
            self.kind = "torch"
            self.accelerator = {
                "device": device,
                "requested_device": want,
                "parameter_device": param_device,
                "torch_nnpa": status,
                "max_abs_prob_diff_vs_cpu": None if diff is None else round(diff, 6),
                "verified": bool(device == "nnpa" and param_device == "nnpa" and diff is not None and diff < 0.05),
            }
            where = "IBM Telum NNPA (torch_nnpa)" if self.accelerator["verified"] else "CPU"
            self.runtime = f"PyTorch MLP on {where}"
            return True
        if kind == "keras" and files.get("keras"):
            os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
            import tensorflow as tf

            devices = [d.name for d in tf.config.list_physical_devices()]
            nnpa = any("NNPA" in d for d in devices)
            model = tf.keras.models.load_model(self.dir / files["keras"], compile=False)
            fn = tf.function(lambda x: model(x, training=False), reduce_retracing=True)
            fn(tf.zeros((1, len(FEATURE_NAMES)), dtype=tf.float32))  # warm-up / trace
            self.model = (model, fn)
            self.kind = "keras"
            disabled = os.environ.get("NNPA_DEVICES") == "0"
            self.accelerator = {
                "device": "nnpa" if nnpa and not disabled else "cpu",
                "nnpa_device_listed": nnpa,
                "nnpa_disabled_by_env": disabled,
                "tf_physical_devices": devices,
                "verified": bool(nnpa and not disabled),
            }
            where = "IBM Telum NNPA via ibm-zdnn-plugin" if self.accelerator["verified"] else "CPU"
            self.runtime = f"TensorFlow {tf.__version__} Keras MLP on {where}"
            return True
        return False

    @property
    def available(self) -> bool:
        return self.kind != "unavailable"

    # ------------------------------------------------------------------ inference
    def _scale(self, x: np.ndarray) -> np.ndarray:
        sc = self.meta.get("scaler")
        if not sc:
            return x
        return (x - np.asarray(sc["mean"], dtype=np.float32)) / np.asarray(sc["scale"], dtype=np.float32)

    def predict_proba(self, rows: np.ndarray) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.float32)
        if rows.ndim == 1:
            rows = rows[None, :]
        if self.kind == "sklearn":
            return np.asarray(self.model.predict_proba(rows))
        if self.kind == "torch":
            with self._lock:
                return self.model.predict_proba(rows)
        if self.kind == "xgboost":
            import xgboost as xgb

            return np.asarray(self.model.inplace_predict(rows)) if hasattr(self.model, "inplace_predict") else self.model.predict(xgb.DMatrix(rows))
        if self.kind == "keras":
            import tensorflow as tf

            _, fn = self.model
            logits = fn(tf.convert_to_tensor(self._scale(rows)))
            return tf.nn.softmax(logits).numpy() if self.meta.get("keras_outputs") == "logits" else np.asarray(logits)
        raise RuntimeError("risk model unavailable")

    def predict(self, vec: list[float]) -> tuple[dict[str, float], float]:
        t0 = time.perf_counter()
        probs = self.predict_proba(np.asarray(vec, dtype=np.float32))[0]
        dt = (time.perf_counter() - t0) * 1000
        with self._count_lock:
            self.inference_count += 1
        return {c: float(p) for c, p in zip(CLASSES, probs)}, dt

    def ml_verdict(self, probs: dict[str, float]) -> Verdict:
        if probs["BLOCK"] >= self.thresholds["tau_block"]:
            return Verdict.BLOCK
        if probs["BLOCK"] + probs["CHALLENGE"] >= self.thresholds["tau_review"]:
            return Verdict.CHALLENGE
        return Verdict.ALLOW

    def top_factors(self, features: dict[str, float], k: int = 5) -> list[dict[str, Any]]:
        """Global importance x deviation from the benign mean: a cheap, honest attribution hint."""
        imp = self.meta.get("feature_importance") or {}
        base = self.meta.get("benign_means") or {}
        scored = []
        for name, weight in imp.items():
            v = features.get(name, 0.0)
            dev = abs(v - base.get(name, 0.0))
            if dev > 1e-9:
                scored.append((weight * dev, name, v))
        scored.sort(reverse=True)
        return [{"feature": n, "value": round(v, 4), "weight": round(s, 4)} for s, n, v in scored[:k]]

    def info(self) -> dict[str, Any]:
        m = dict(self.meta)
        m.pop("benign_means", None)
        return {
            "available": self.available,
            "kind": self.kind,
            "runtime": self.runtime,
            "version": self.version,
            "accelerator": self.accelerator,
            "thresholds": self.thresholds,
            "inference_count": self.inference_count,
            "last_error": self.last_error,
            "meta": m,
        }
