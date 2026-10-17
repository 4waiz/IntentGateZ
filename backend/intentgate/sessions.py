"""Per-viewer sandboxes so concurrent judges never interfere with each other's simulation.

Each session owns its simulation world, intent registry, decisions and pending challenges.
The audit chain is global and every record carries the session id.
"""

from __future__ import annotations

import asyncio
import secrets
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

from .intents import IntentRegistry
from .simulation import SimulationWorld


@dataclass
class Session:
    id: str
    created_at: float
    world: SimulationWorld
    intents: IntentRegistry
    supervisor_token: str
    last_seen: float = field(default_factory=time.time)
    decisions: "OrderedDict[str, Any]" = field(default_factory=OrderedDict)
    actions: dict[str, Any] = field(default_factory=dict)
    challenges: dict[str, Any] = field(default_factory=dict)
    used_grant_nonces: set[str] = field(default_factory=set)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    scenario: dict[str, Any] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)

    def remember(self, decision: Any) -> None:
        self.decisions[decision.decision_id] = decision
        self.actions[decision.action_id] = decision.decision_id
        while len(self.decisions) > 400:
            old_id, old = self.decisions.popitem(last=False)
            self.actions.pop(old.action_id, None)


SUPERVISOR = {"id": "sup_okafor", "name": "R. Okafor", "role": "supervisor", "title": "Duty Operations Supervisor"}
OPERATORS = {
    "dispatcher": {"id": "op_dispatch_chen", "name": "M. Chen", "role": "dispatcher"},
    "logistics_officer": {"id": "lo_amira", "name": "A. Haddad", "role": "logistics_officer"},
    "hospital_coordinator": {"id": "hc_lena", "name": "L. Varga", "role": "hospital_coordinator"},
}


class SessionManager:
    def __init__(self, signing_key: bytes, max_sessions: int = 200, ttl_s: int = 7200) -> None:
        self._key = signing_key
        self._max = max_sessions
        self._ttl = ttl_s
        self._sessions: OrderedDict[str, Session] = OrderedDict()
        self._lock = threading.Lock()
        self.loop: asyncio.AbstractEventLoop | None = None

    def create(self) -> Session:
        sid = "ses_" + secrets.token_urlsafe(12)
        s = Session(
            id=sid,
            created_at=time.time(),
            world=SimulationWorld(session_seed=secrets.randbelow(1_000_000)),
            intents=IntentRegistry(self._key),
            supervisor_token=secrets.token_urlsafe(24),
        )
        with self._lock:
            self._sessions[sid] = s
            self._evict()
        return s

    def get(self, sid: str | None) -> Session | None:
        if not sid:
            return None
        with self._lock:
            s = self._sessions.get(sid)
            if s is None:
                return None
            if time.time() - s.last_seen > self._ttl:
                self._sessions.pop(sid, None)
                return None
            s.last_seen = time.time()
            self._sessions.move_to_end(sid)
            return s

    def reset(self, s: Session) -> None:
        with s.lock:
            s.world = SimulationWorld(session_seed=secrets.randbelow(1_000_000))
            s.intents = IntentRegistry(self._key)
            s.decisions.clear()
            s.actions.clear()
            s.challenges.clear()
            s.scenario.clear()

    def _evict(self) -> None:
        now = time.time()
        for sid in [k for k, v in self._sessions.items() if now - v.last_seen > self._ttl]:
            self._sessions.pop(sid, None)
        while len(self._sessions) > self._max:
            self._sessions.popitem(last=False)

    def count(self) -> int:
        return len(self._sessions)

    def all(self) -> list[Session]:
        with self._lock:
            return list(self._sessions.values())

    # ------------------------------------------------------------ live events
    def publish(self, s: Session, event: dict[str, Any]) -> None:
        if not s.subscribers or self.loop is None:
            return
        for q in list(s.subscribers):
            try:
                self.loop.call_soon_threadsafe(_offer, q, event)
            except RuntimeError:
                pass


def _offer(q: asyncio.Queue, event: dict[str, Any]) -> None:
    if q.full():
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
    q.put_nowait(event)
