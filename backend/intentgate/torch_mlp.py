"""PyTorch risk MLP used for the IBM Telum NNPA inference path (via IBM's torch_nnpa).

Trained on CPU (torch_nnpa is inference-only). At serving time the model can be moved to the
"nnpa" device; `nnpa_status()` reports whether that device is actually available and usable.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np


def _torch():
    import torch

    return torch


def build(n_in: int, h1: int = 64, h2: int = 32, n_out: int = 3):
    nn = _torch().nn
    return nn.Sequential(nn.Linear(n_in, h1), nn.ReLU(), nn.Linear(h1, h2), nn.ReLU(), nn.Linear(h2, n_out))


def nnpa_status() -> dict:
    """Facts about the NNPA device from torch_nnpa; never assumed."""
    out = {"torch_nnpa_installed": False, "available": False, "device_count": 0, "smoke_test": None}
    try:
        torch = _torch()
        import torch_nnpa  # noqa: F401  (registers the "nnpa" device)

        out["torch_nnpa_installed"] = True
        out["torch_nnpa_version"] = getattr(torch_nnpa, "__version__", None)
        mod = getattr(torch, "nnpa", None) or torch_nnpa
        out["available"] = bool(getattr(mod, "is_available", lambda: False)())
        out["device_count"] = int(getattr(mod, "device_count", lambda: 0)())
        if out["available"]:
            with torch.inference_mode():
                a = torch.ones(8, 8).to("nnpa")
                y = (a @ a).to("cpu")
            out["smoke_test"] = bool(float(y[0, 0]) == 8.0)
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"[:300]
    return out


class TorchRisk:
    """Wraps a trained MLP with its input scaler; predict_proba matches the sklearn API."""

    def __init__(self, model, mean, scale, device: str = "cpu"):
        torch = _torch()
        self.torch = torch
        self.mean = torch.tensor(np.asarray(mean, dtype=np.float32))
        self.scale = torch.tensor(np.asarray(scale, dtype=np.float32))
        self.model = model.eval()
        self.device = "cpu"
        self.to(device)

    def to(self, device: str) -> "TorchRisk":
        if device == "nnpa":
            import torch_nnpa  # noqa: F401
        self.model = self.model.to(device)
        self.device = device
        return self

    def predict_proba(self, X) -> np.ndarray:
        torch = self.torch
        x = (torch.tensor(np.asarray(X, dtype=np.float32)) - self.mean) / self.scale
        with torch.inference_mode():
            logits = self.model(x.to(self.device))
            p = torch.softmax(logits.to("cpu").float(), dim=1)
        return p.numpy()

    def save(self, path: Path, meta: dict | None = None) -> None:
        torch = self.torch
        model_cpu = self.model.to("cpu")
        torch.save({"state_dict": model_cpu.state_dict(), "mean": self.mean.numpy().tolist(), "scale": self.scale.numpy().tolist(), "n_in": int(self.mean.numel()), "meta": meta or {}}, path)
        self.model = model_cpu.to(self.device)

    @classmethod
    def load(cls, path: Path, device: str = "cpu") -> "TorchRisk":
        torch = _torch()
        blob = torch.load(path, map_location="cpu", weights_only=False)
        m = build(blob["n_in"])
        m.load_state_dict(blob["state_dict"])
        return cls(m, blob["mean"], blob["scale"], device)


def train(Xtr: np.ndarray, ytr: np.ndarray, Xva: np.ndarray, yva: np.ndarray, seed: int, epochs: int = 60) -> TorchRisk:
    torch = _torch()
    torch.manual_seed(seed)
    np.random.seed(seed)
    mean, scale = Xtr.mean(0), Xtr.std(0) + 1e-6
    xt = torch.tensor(((Xtr - mean) / scale).astype(np.float32))
    yt = torch.tensor(ytr.astype(np.int64))
    xv = torch.tensor(((Xva - mean) / scale).astype(np.float32))
    yv = torch.tensor(yva.astype(np.int64))
    counts = np.bincount(ytr, minlength=3)
    w = torch.tensor([len(ytr) / (3 * max(1, c)) for c in counts], dtype=torch.float32)
    model = build(Xtr.shape[1])
    opt = torch.optim.Adam(model.parameters(), lr=2e-3, weight_decay=1e-4)
    lossf = torch.nn.CrossEntropyLoss(weight=w)
    best, best_state, patience = float("inf"), None, 0
    t0 = time.perf_counter()
    for _ in range(epochs):
        model.train()
        perm = torch.randperm(len(xt))
        for i in range(0, len(xt), 128):
            idx = perm[i : i + 128]
            opt.zero_grad()
            loss = lossf(model(xt[idx]), yt[idx])
            loss.backward()
            opt.step()
        model.eval()
        with torch.no_grad():
            vl = float(lossf(model(xv), yv))
        if vl < best - 1e-4:
            best, best_state, patience = vl, {k: v.clone() for k, v in model.state_dict().items()}, 0
        else:
            patience += 1
            if patience >= 6:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    tr = TorchRisk(model, mean, scale, "cpu")
    tr.train_seconds = round(time.perf_counter() - t0, 2)
    return tr
