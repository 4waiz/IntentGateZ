"""Optional grounded explanations from a local IBM Granite model (llama-cpp-python).

The language model never decides anything. It receives the already-final verdict and the
verified policy findings, and rewrites them as a short operator-facing explanation. If no
local model is configured, the endpoint reports that instead of falling back to any external
API.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any

from .config import Settings

PROMPT = """You are an assistant in an emergency operations security console. Explain the security decision below to a human dispatcher in 2-3 short sentences. Use only the facts given. Do not change the verdict, do not invent facts, and do not recommend bypassing controls.

Verdict: {verdict}
Agent: {agent}
Operator's original instruction: {instruction}
Proposed action: {action}
Policy findings:
{findings}
Model risk score: {risk}

Explanation:"""


class Explainer:
    def __init__(self, settings: Settings) -> None:
        self.model_path = os.environ.get("INTENTGATE_LLM_PATH", "")
        self.threads = int(os.environ.get("INTENTGATE_LLM_THREADS", "2"))
        self._llm = None
        self._lock = threading.Lock()
        self._reason = ""
        self._cache: dict[str, dict[str, Any]] = {}
        self.backend = None
        if not self.model_path:
            self._reason = "INTENTGATE_LLM_PATH not set; Granite explanations disabled"
        elif not os.path.isfile(self.model_path):
            self._reason = f"model file not found: {os.path.basename(self.model_path)}"
        else:
            try:
                import llama_cpp  # noqa: F401

                self.backend = "llama-cpp-python"
            except Exception as exc:
                self._reason = f"llama_cpp unavailable: {exc.__class__.__name__}"

    @property
    def available(self) -> bool:
        return self.backend is not None

    def info(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "backend": self.backend,
            "model": os.path.basename(self.model_path) if self.model_path else None,
            "reason": self._reason or None,
            "role": "explanations only; never an authority for decisions",
        }

    def _load(self):
        if self._llm is None:
            from llama_cpp import Llama

            self._llm = Llama(model_path=self.model_path, n_ctx=1024, n_threads=self.threads, verbose=False)
        return self._llm

    def explain(self, decision: Any) -> dict[str, Any]:
        if decision.decision_id in self._cache:
            return {**self._cache[decision.decision_id], "cached": True}
        a = decision.action
        findings = "\n".join(f"- [{f.outcome.upper()}] {f.code} {f.check}: {f.message}" for f in decision.findings if f.outcome != "pass") or "- all checks passed"
        prompt = PROMPT.format(
            verdict=decision.verdict.value,
            agent=a.agent_id,
            instruction=decision.intent.instruction if decision.intent else "(none registered)",
            action=f"{a.action_type.value} on {a.target} with {a.parameters}",
            findings=findings,
            risk=f"{decision.risk.risk_score:.2f}" if decision.risk else "n/a",
        )
        with self._lock:
            llm = self._load()
            t0 = time.perf_counter()
            out = llm(prompt, max_tokens=110, temperature=0.2, stop=["\n\n", "Verdict:"])
            dt = (time.perf_counter() - t0) * 1000
        text = out["choices"][0]["text"].strip()
        res = {
            "text": text,
            "model": os.path.basename(self.model_path),
            "backend": self.backend,
            "tokens": out.get("usage", {}).get("completion_tokens"),
            "latency_ms": round(dt, 1),
            "grounding": "verdict and findings supplied by the gateway; the model only rephrases them",
        }
        self._cache[decision.decision_id] = res
        return res
