"""In-process runtime metrics: decision counts and latency distributions."""

from __future__ import annotations

import threading
import time
from collections import Counter, deque
from typing import Any

import numpy as np


class Metrics:
    def __init__(self, window: int = 5000) -> None:
        self._lock = threading.Lock()
        self.started = time.time()
        self.verdicts: Counter[str] = Counter()
        self.decisions = 0
        self.http_requests = 0
        self.latency: dict[str, deque[float]] = {
            "decision_ms": deque(maxlen=window),
            "inference_ms": deque(maxlen=window),
            "policy_ms": deque(maxlen=window),
            "features_ms": deque(maxlen=window),
            "end_to_end_ms": deque(maxlen=window),
        }

    def record(self, verdict: str, timings: dict[str, float]) -> None:
        with self._lock:
            self.decisions += 1
            self.verdicts[verdict] += 1
            for k, q in self.latency.items():
                if k in timings:
                    q.append(timings[k])

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            lat = {}
            for k, q in self.latency.items():
                if q:
                    a = np.fromiter(q, dtype=float)
                    lat[k] = {
                        "n": int(a.size),
                        "p50": round(float(np.percentile(a, 50)), 3),
                        "p95": round(float(np.percentile(a, 95)), 3),
                        "p99": round(float(np.percentile(a, 99)), 3),
                        "mean": round(float(a.mean()), 3),
                        "max": round(float(a.max()), 3),
                    }
            return {
                "uptime_s": round(time.time() - self.started, 1),
                "decisions": self.decisions,
                "verdicts": dict(self.verdicts),
                "http_requests": self.http_requests,
                "latency": lat,
            }
