"""Instruction-injection indicators for untrusted text.

Two layers:
* a trained text classifier (TF-IDF character/word n-grams + logistic regression) loaded from
  `ml/artifacts/injection_text_model.joblib` when present;
* transparent lexical indicators, used as model features and by the rules-only baseline.
If the trained model is unavailable the score falls back to the lexical heuristic and the
runtime reports that fallback explicitly.
"""

from __future__ import annotations

import hashlib
import re
from collections import OrderedDict
from pathlib import Path

INJECTION_PATTERNS = [
    r"\bignore (all |any )?(previous|prior|earlier|above|existing) (instructions|orders|directives|guidance)",
    r"\boverrid(e|es|ing) (all |any )?(previous|prior|operator|dispatcher|existing|standing)",
    r"\b(ai|routing|automated|autonomous|dispatch) (agent|assistant|system|planner)s?\b[^.]{0,60}\b(must|should|shall|are required|are instructed)\b",
    r"\bdisregard\b",
    r"\bnew (instructions|directive|directives|orders)\b",
    r"\bsystem (prompt|override|message|instruction)\b",
    r"\bdo not (inform|notify|tell|alert|log|report)\b",
    r"\b(immediately|urgently|now) (redirect|reroute|divert|send|transfer|cancel|mark)\b",
    r"\bthis (instruction|message|notice|directive) (supersedes|overrides|replaces)\b",
    r"\b(forward|send|share|email|upload|export) (the |all |any )?(patient|medical|health|clinical) (record|records|data|file|files|history)\b",
    r"\bon behalf of (the )?(dispatch |medical )?(supervisor|director|administrator|commander)\b",
    r"\bauthori[sz]ed by (the )?(dispatch |medical )?(supervisor|director|administrator)\b",
    r"\b(you|agents?) (are|is) (now )?(authori[sz]ed|permitted|allowed) to\b",
    r"\bwithout (operator|human|supervisor) (approval|confirmation|review)\b",
]
_PATTERNS = [re.compile(p, re.IGNORECASE) for p in INJECTION_PATTERNS]
_IMPERATIVES = {
    "redirect", "reroute", "divert", "send", "transfer", "cancel", "mark", "ignore", "forward", "share",
    "email", "upload", "disregard", "override", "delete", "approve", "purchase", "order", "set", "dispatch",
}


def lexical_hits(text: str) -> int:
    return sum(1 for p in _PATTERNS if p.search(text or ""))


def imperative_density(text: str) -> float:
    sentences = [s.strip() for s in re.split(r"[.!?\n]+", text or "") if s.strip()]
    if not sentences:
        return 0.0
    hits = 0
    for s in sentences:
        words = re.findall(r"[a-zA-Z']+", s.lower())
        if not words:
            continue
        if words[0] in _IMPERATIVES or (len(words) > 2 and words[0] in {"please", "all", "agents"} and any(w in _IMPERATIVES for w in words[1:4])):
            hits += 1
    return hits / len(sentences)


def lexical_score(text: str) -> float:
    h = lexical_hits(text)
    d = imperative_density(text)
    return min(1.0, 0.32 * h + 0.35 * d)


class InjectionDetector:
    def __init__(self, artifacts_dir: Path | None = None) -> None:
        self.model = None
        self.version = "lexical-heuristic"
        self.runtime = "lexical heuristic (no trained text model loaded)"
        self._cache: OrderedDict[str, float] = OrderedDict()
        if artifacts_dir is not None:
            path = Path(artifacts_dir) / "injection_text_model.joblib"
            if path.is_file():
                try:
                    import joblib

                    bundle = joblib.load(path)
                    self.model = bundle["pipeline"]
                    self.version = bundle.get("version", "unknown")
                    self.runtime = f"scikit-learn TF-IDF + LogisticRegression ({self.version})"
                except Exception as exc:  # pragma: no cover - surfaced through /api/model/info
                    self.runtime = f"lexical heuristic (text model failed to load: {exc.__class__.__name__})"

    def score(self, text: str) -> float:
        if not text:
            return 0.0
        key = hashlib.blake2b(text.encode("utf-8"), digest_size=12).hexdigest()
        hit = self._cache.get(key)
        if hit is not None:
            self._cache.move_to_end(key)
            return hit
        if self.model is not None:
            val = float(self.model.predict_proba([text])[0][1])
        else:
            val = lexical_score(text)
        self._cache[key] = val
        if len(self._cache) > 4096:
            self._cache.popitem(last=False)
        return val
