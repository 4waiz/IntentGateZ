"""Registry of human intents: immutable, versioned and HMAC-signed.

Agents only ever reference an intent by id and version. The gateway always reloads the
registered record and verifies its signature, so text arriving through tools or feeds has no
path to rewrite what the human authorised. Amendments create a new version and make older
versions stale.
"""

from __future__ import annotations

import secrets
import threading
import time

from .schemas import HumanIntent, IntentCreate
from .util import canonical_json, hmac_hex, hmac_ok, new_id


class IntentRegistry:
    def __init__(self, signing_key: bytes) -> None:
        self._key = signing_key
        self._versions: dict[str, list[HumanIntent]] = {}
        self._lock = threading.Lock()

    def _sign(self, intent: HumanIntent) -> HumanIntent:
        body = canonical_json(intent.model_dump(mode="json", exclude={"signature"}))
        return intent.model_copy(update={"signature": hmac_hex(self._key, body)})

    def verify(self, intent: HumanIntent) -> bool:
        body = canonical_json(intent.model_dump(mode="json", exclude={"signature"}))
        return hmac_ok(self._key, body, intent.signature)

    def _build(self, req: IntentCreate, intent_id: str, version: int, created_at: float) -> HumanIntent:
        return HumanIntent(
            intent_id=intent_id,
            version=version,
            operator_id=req.operator_id,
            operator_role=req.operator_role,
            instruction=req.instruction,
            authorized_operations=tuple(req.authorized_operations),
            permitted_targets=req.permitted_targets,
            resource_limits=req.resource_limits,
            financial=req.financial,
            routing=req.routing,
            created_at=created_at,
            expires_at=created_at + req.ttl_minutes * 60,
            nonce=secrets.token_hex(8),
        )

    def create(self, req: IntentCreate, intent_id: str | None = None, created_at: float | None = None) -> HumanIntent:
        created_at = time.time() if created_at is None else created_at
        intent = self._sign(self._build(req, intent_id or new_id("int"), 1, created_at))
        with self._lock:
            if intent.intent_id in self._versions:
                raise ValueError("intent id already registered")
            self._versions[intent.intent_id] = [intent]
        return intent

    def amend(self, intent_id: str, req: IntentCreate) -> HumanIntent:
        with self._lock:
            versions = self._versions.get(intent_id)
            if not versions:
                raise KeyError(intent_id)
            intent = self._sign(self._build(req, intent_id, versions[-1].version + 1, time.time()))
            versions.append(intent)
            return intent

    def get(self, intent_id: str, version: int | None = None) -> HumanIntent | None:
        versions = self._versions.get(intent_id)
        if not versions:
            return None
        if version is None:
            return versions[-1]
        for v in versions:
            if v.version == version:
                return v
        return None

    def latest_version(self, intent_id: str) -> int | None:
        versions = self._versions.get(intent_id)
        return versions[-1].version if versions else None

    def all(self) -> list[HumanIntent]:
        return [v[-1] for v in self._versions.values()]
