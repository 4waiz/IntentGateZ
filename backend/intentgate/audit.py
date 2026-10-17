"""Tamper-evident audit log: canonical JSON events chained with SHA-256 in SQLite.

Threat model (see docs/security-model.md): each record commits to the previous record's hash,
so editing, deleting or reordering any stored event breaks verification from that point on.
This detects modification by anyone who cannot also recompute every later hash; it does not
make the log immutable. An attacker with write access to the database and to the code could
rebuild the whole chain, which is why the head hash is returned with every decision (so
clients can keep independent copies) and can be exported for external anchoring.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from .util import canonical_json, iso, sha256_hex

GENESIS = "0" * 64


class AuditLog:
    def __init__(self, db_path: Path | str) -> None:
        self.path = str(db_path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS audit_events (
                seq INTEGER PRIMARY KEY,
                ts REAL NOT NULL,
                session_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                subject_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                prev_hash TEXT NOT NULL,
                hash TEXT NOT NULL
            )"""
        )
        self._db.execute("CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events(session_id, seq)")
        self._lock = threading.Lock()
        row = self._db.execute("SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1").fetchone()
        self._seq, self._head = (row[0], row[1]) if row else (0, GENESIS)

    @staticmethod
    def _digest(prev_hash: str, seq: int, ts: float, session_id: str, event_type: str, subject_id: str, payload: str) -> str:
        body = canonical_json(
            {"seq": seq, "ts": repr(ts), "session_id": session_id, "event_type": event_type, "subject_id": subject_id, "payload": payload}
        )
        return sha256_hex(prev_hash + "|" + body)

    def append(self, event_type: str, session_id: str, subject_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        data = canonical_json(payload)
        with self._lock:
            seq = self._seq + 1
            ts = time.time()
            h = self._digest(self._head, seq, ts, session_id, event_type, subject_id, data)
            self._db.execute(
                "INSERT INTO audit_events(seq, ts, session_id, event_type, subject_id, payload, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?)",
                (seq, ts, session_id, event_type, subject_id, data, self._head, h),
            )
            prev, self._seq, self._head = self._head, seq, h
        return {"seq": seq, "ts": ts, "time": iso(ts), "hash": h, "prev_hash": prev, "event_type": event_type}

    def head(self) -> dict[str, Any]:
        return {"seq": self._seq, "hash": self._head}

    def verify(self) -> dict[str, Any]:
        started = time.perf_counter()
        prev = GENESIS
        count = 0
        first_bad: int | None = None
        reason = ""
        expected_seq = 1
        for seq, ts, sid, et, subj, payload, prev_hash, h in self._db.execute(
            "SELECT seq, ts, session_id, event_type, subject_id, payload, prev_hash, hash FROM audit_events ORDER BY seq"
        ):
            count += 1
            if seq != expected_seq:
                first_bad, reason = seq, f"sequence gap: expected {expected_seq}"
                break
            if prev_hash != prev:
                first_bad, reason = seq, "prev_hash does not match previous record"
                break
            if self._digest(prev, seq, ts, sid, et, subj, payload) != h:
                first_bad, reason = seq, "record hash mismatch (content modified)"
                break
            prev = h
            expected_seq += 1
        return {
            "ok": first_bad is None,
            "records_checked": count,
            "head_hash": prev if first_bad is None else None,
            "first_bad_seq": first_bad,
            "reason": reason,
            "verified_at": iso(time.time()),
            "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            "algorithm": "SHA-256 hash chain over canonical JSON",
        }

    def list(self, session_id: str | None = None, limit: int = 100, before_seq: int | None = None) -> list[dict[str, Any]]:
        q = "SELECT seq, ts, session_id, event_type, subject_id, payload, prev_hash, hash FROM audit_events"
        conds, args = [], []
        if session_id:
            conds.append("session_id = ?")
            args.append(session_id)
        if before_seq:
            conds.append("seq < ?")
            args.append(before_seq)
        if conds:
            q += " WHERE " + " AND ".join(conds)
        q += " ORDER BY seq DESC LIMIT ?"
        args.append(max(1, min(limit, 1000)))
        return [self._row(r) for r in self._db.execute(q, args)]

    def get(self, seq: int) -> dict[str, Any] | None:
        r = self._db.execute(
            "SELECT seq, ts, session_id, event_type, subject_id, payload, prev_hash, hash FROM audit_events WHERE seq = ?", (seq,)
        ).fetchone()
        return self._row(r) if r else None

    @staticmethod
    def _row(r: tuple) -> dict[str, Any]:
        seq, ts, sid, et, subj, payload, prev_hash, h = r
        return {
            "seq": seq,
            "ts": ts,
            "time": iso(ts),
            "session_id": sid,
            "event_type": et,
            "subject_id": subj,
            "payload": json.loads(payload),
            "prev_hash": prev_hash,
            "hash": h,
        }

    def count(self) -> int:
        return self._seq


def _main() -> None:
    import argparse

    from .config import settings

    ap = argparse.ArgumentParser(description="Verify or export the IntentGate Z audit chain")
    ap.add_argument("command", choices=["verify", "export"])
    ap.add_argument("--db", default=str(settings.db_path))
    ap.add_argument("--session", default=None)
    args = ap.parse_args()
    log = AuditLog(args.db)
    if args.command == "verify":
        print(json.dumps(log.verify(), indent=2))
    else:
        print(json.dumps(list(reversed(log.list(args.session, limit=1000))), indent=2))


if __name__ == "__main__":
    _main()
