"""The IntentGate Z action gateway.

Pipeline for every proposed agent action:

    human intent (registered, signed) -> agent proposal -> identity & capability
    -> hard policy -> contextual features -> ML risk inference -> fusion
    -> ALLOW (execute) | CHALLENGE (hold for supervisor) | BLOCK (prevent)
    -> tamper-evident audit -> live event to the UI

The simulator is only mutated from `_execute`, which is reachable only after an ALLOW verdict
or after a supervisor grant has been verified and the hard policy has been re-checked.
"""

from __future__ import annotations

import base64
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any

from .audit import AuditLog
from .config import Settings
from .features import FEATURE_NAMES, extract, vector
from .injection import InjectionDetector
from .metrics import Metrics
from .policy import PolicyEngine, PolicyResult
from .risk_model import RiskModel
from .schemas import (
    AgentAction,
    AgentActionIn,
    Decision,
    Finding,
    OperationType,
    RiskEstimate,
    Verdict,
    max_verdict,
)
from .sessions import SUPERVISOR, Session, SessionManager
from .util import canonical_json, hmac_hex, new_id, sha256_hex


class GatewayError(Exception):
    def __init__(self, status: int, code: str, message: str, detail: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail


def action_fingerprint(a: AgentActionIn | AgentAction) -> str:
    return sha256_hex(
        canonical_json(
            {
                "agent_id": a.agent_id,
                "intent_id": a.intent_id,
                "intent_version": a.intent_version,
                "action_type": a.action_type.value,
                "tool": a.tool,
                "target": a.target,
                "parameters": a.parameters,
            }
        )
    )


@dataclass
class _Clock:
    start: float

    def ms(self) -> float:
        return round((time.perf_counter() - self.start) * 1000, 3)


class Gateway:
    def __init__(self, settings: Settings, audit: AuditLog, risk: RiskModel, injection: InjectionDetector, metrics: Metrics, sessions: SessionManager) -> None:
        self.settings = settings
        self.audit = audit
        self.risk = risk
        self.injection = injection
        self.policy = PolicyEngine(injection)
        self.metrics = metrics
        self.sessions = sessions

    # ------------------------------------------------------------------ evaluate
    def evaluate(self, s: Session, action_in: AgentActionIn, *, simulated_adversary: bool = False, origin: str = "api") -> Decision:
        clock = _Clock(time.perf_counter())
        trace: list[dict[str, Any]] = []

        def mark(step: str, **kw: Any) -> None:
            trace.append({"step": step, "t_ms": clock.ms(), **kw})

        with s.lock:
            now = time.time()
            fp = action_fingerprint(action_in)
            action = AgentAction(
                **action_in.model_dump(),
                action_id=new_id("act"),
                session_id=s.id,
                created_at=now,
                fingerprint=fp,
            )
            mark("proposal.received", action_id=action.action_id, agent_id=action.agent_id, origin=origin)
            a_prop = self.audit.append(
                "action.proposed",
                s.id,
                action.action_id,
                {
                    "agent_id": action.agent_id,
                    "intent_id": action.intent_id,
                    "intent_version": action.intent_version,
                    "action_type": action.action_type.value,
                    "tool": action.tool,
                    "target": action.target,
                    "parameters": action.parameters,
                    "provenance": [{"source_id": p.source_id, "trust": p.trust.value, "fields": p.influenced_fields} for p in action.provenance],
                    "fingerprint": fp,
                    "simulated_adversary": simulated_adversary,
                    "origin": origin,
                },
            )
            mark("audit.append", event="action.proposed", seq=a_prop["seq"], hash=a_prop["hash"])

            intent = s.intents.get(action.intent_id, action.intent_version)
            sig_ok = intent is not None and s.intents.verify(intent)
            latest = s.intents.latest_version(action.intent_id)
            mark("intent.loaded", intent_id=action.intent_id, version=action.intent_version, signature_ok=sig_ok, latest_version=latest)

            t0 = time.perf_counter()
            pr = self.policy.evaluate(action, intent, sig_ok, latest, s.world, now)
            if fp in s.world.executed_fingerprints:
                pr.findings.append(Finding(code="IG-REPLAY-001", check="Replay protection", outcome="block", message="An identical action was already executed; replays are refused.", evidence={"fingerprint": fp}))
                pr.verdict = Verdict.BLOCK
            policy_ms = (time.perf_counter() - t0) * 1000
            n_block = sum(f.outcome == "block" for f in pr.findings)
            n_chal = sum(f.outcome == "challenge" for f in pr.findings)
            mark("policy.evaluated", checks=len(pr.findings), blocks=n_block, challenges=n_chal, hard_verdict=pr.verdict.value)

            t1 = time.perf_counter()
            feats = extract(action, intent, latest, s.world, pr.context, self.injection, now)
            features_ms = (time.perf_counter() - t1) * 1000
            mark("features.extracted", count=len(FEATURE_NAMES))

            risk: RiskEstimate | None = None
            ml_v = Verdict.ALLOW
            inference_ms = 0.0
            if self.risk.available:
                probs, inference_ms = self.risk.predict(vector(feats))
                ml_v, corroboration = self.risk.ml_verdict(probs, feats)
                risk = RiskEstimate(
                    p_allow=round(probs["ALLOW"], 5),
                    p_challenge=round(probs["CHALLENGE"], 5),
                    p_block=round(probs["BLOCK"], 5),
                    risk_score=round(1.0 - probs["ALLOW"], 5),
                    ml_verdict=ml_v,
                    thresholds=self.risk.thresholds,
                    top_factors=self.risk.top_factors(feats),
                    corroboration=corroboration,
                    runtime=self.risk.runtime,
                    model_version=self.risk.version,
                )
                mark("ml.inference", runtime=self.risk.runtime, device=self.risk.accelerator.get("device"), latency_ms=round(inference_ms, 3), ml_verdict=ml_v.value, risk_score=risk.risk_score)
            else:
                pr.findings.append(Finding(code="IG-ML-000", check="Risk model", outcome="info", message="Risk model unavailable; decision uses hard policy only.", evidence={"error": self.risk.last_error}))
                mark("ml.inference", runtime="unavailable")

            verdict = max_verdict(pr.verdict, ml_v)
            decision_ms = clock.ms()
            mark("decision.fused", verdict=verdict.value, hard=pr.verdict.value, ml=ml_v.value)

            decision_id = new_id("dec")
            status = "prevented"
            executed_route = ghost_route = None
            challenge = None
            execution: dict[str, Any] | None = None
            if verdict == Verdict.ALLOW:
                try:
                    execution = s.world.execute(action)
                    s.world.executed_fingerprints.add(fp)
                    status = "executed"
                    executed_route = execution.get("route")
                    mark("simulation.executed", state_version=execution["state_version"])
                except ValueError as exc:
                    pr.findings.append(Finding(code="IG-EXEC-001", check="Execution", outcome="block", message=f"Execution failed safely: {exc}"))
                    verdict = Verdict.BLOCK
                    status = "prevented"
                    mark("simulation.failed", reason=str(exc))
            elif verdict == Verdict.CHALLENGE:
                challenge = self._open_challenge(s, action, decision_id, pr, intent, now)
                status = "pending_review"
                mark("challenge.opened", challenge_id=challenge["challenge_id"], required_role=challenge["required_role"])
            if verdict == Verdict.BLOCK:
                ghost_route = self._ghost_route(s, action)
                mark("simulation.prevented", state_unchanged=True)
            s.world.record_history(action, verdict.value)

            explanation = self._explain(verdict, pr, risk, ml_v)
            a_dec = self.audit.append(
                "decision.made",
                s.id,
                decision_id,
                {
                    "action_id": action.action_id,
                    "fingerprint": fp,
                    "verdict": verdict.value,
                    "hard_verdict": pr.verdict.value,
                    "ml_verdict": ml_v.value,
                    "risk": risk.model_dump(mode="json", exclude={"top_factors"}) if risk else None,
                    "findings": [{"code": f.code, "outcome": f.outcome} for f in pr.findings if f.outcome != "pass"],
                    "decision_ms": decision_ms,
                },
            )
            mark("audit.append", event="decision.made", seq=a_dec["seq"], hash=a_dec["hash"])
            outcome_event = {"executed": "action.executed", "pending_review": "challenge.opened"}.get(status, "action.prevented")
            a_out = self.audit.append(
                outcome_event,
                s.id,
                action.action_id,
                {"decision_id": decision_id, "status": status, "execution": execution, "challenge_id": challenge["challenge_id"] if challenge else None},
            )
            mark("audit.append", event=outcome_event, seq=a_out["seq"], hash=a_out["hash"])

            end_ms = clock.ms()
            decision = Decision(
                decision_id=decision_id,
                action_id=action.action_id,
                session_id=s.id,
                verdict=verdict,
                hard_verdict=pr.verdict,
                status=status,
                findings=pr.findings,
                risk=risk,
                explanation=explanation,
                fingerprint=fp,
                intent=intent,
                action=action,
                features={k: round(v, 5) for k, v in feats.items()},
                trust_boundary=pr.trust_boundary,
                ghost_route=ghost_route,
                executed_route=executed_route,
                challenge=challenge,
                latency_ms={
                    "decision_ms": decision_ms,
                    "policy_ms": round(policy_ms, 3),
                    "features_ms": round(features_ms, 3),
                    "inference_ms": round(inference_ms, 3),
                    "end_to_end_ms": end_ms,
                },
                audit={"proposed": a_prop, "decision": a_dec, "outcome": a_out},
                timestamp=now,
                simulated_adversary=simulated_adversary,
                trace=trace,
            )
            s.remember(decision)

        self.metrics.record(verdict.value, decision.latency_ms)
        self.sessions.publish(s, {"type": "decision", "decision_id": decision_id, "verdict": verdict.value, "status": status, "state_version": s.world.version})
        return decision

    # ------------------------------------------------------------------ helpers
    def _ghost_route(self, s: Session, action: AgentAction) -> list[str] | None:
        p = action.parameters
        if action.action_type not in (OperationType.REROUTE_AMBULANCE, OperationType.DISPATCH_AMBULANCE):
            return None
        if p.get("route"):
            return list(p["route"])
        amb = s.world.ambulances.get(p["ambulance_id"])
        hosp = s.world.city.hospitals.get(p["destination_hospital_id"])
        if not amb or not hosp:
            return None
        if action.action_type == OperationType.DISPATCH_AMBULANCE and p.get("incident_id") in s.world.incidents:
            return s.world.plan_dispatch_route(amb, s.world.incidents[p["incident_id"]], hosp.id)
        start, _ = s.world.current_anchor(amb)
        res = s.world.route_for(start, hosp.node)
        return res[0] if res else None

    @staticmethod
    def _explain(verdict: Verdict, pr: PolicyResult, risk: RiskEstimate | None, ml_v: Verdict) -> str:
        blocks = [f for f in pr.findings if f.outcome == "block"]
        chals = [f for f in pr.findings if f.outcome == "challenge"]
        ml_txt = ""
        if risk is not None:
            ml_txt = f" Model risk {risk.risk_score:.2f} (P(block)={risk.p_block:.2f}) -> model alone says {ml_v.value}."
        if verdict == Verdict.BLOCK:
            if blocks:
                reasons = "; ".join(f"{f.message} [{f.code}]" for f in blocks[:3])
                return f"Blocked before execution. {reasons}.{ml_txt}"
            return f"Blocked before execution: the risk model scored this action above the block threshold.{ml_txt}"
        if verdict == Verdict.CHALLENGE:
            if chals:
                reasons = "; ".join(f"{f.message} [{f.code}]" for f in chals[:3])
                return f"Held for human review. {reasons}.{ml_txt}"
            return f"Held for human review: the risk model flagged this action as unusual.{ml_txt}"
        passed = sum(f.outcome == "pass" for f in pr.findings)
        return f"Allowed: {passed} policy checks passed and the action matches the operator's intent.{ml_txt}"

    def _open_challenge(self, s: Session, action: AgentAction, decision_id: str, pr: PolicyResult, intent: Any, now: float) -> dict[str, Any]:
        review = [f for f in pr.findings if f.outcome == "challenge"]
        ch = {
            "challenge_id": new_id("chl"),
            "decision_id": decision_id,
            "action_id": action.action_id,
            "fingerprint": action.fingerprint,
            "intent_id": action.intent_id,
            "intent_version": action.intent_version,
            "intent_operator": intent.operator_id if intent else None,
            "agent_id": action.agent_id,
            "review_codes": [f.code for f in review] or ["IG-ML-REVIEW"],
            "review_findings": [f.model_dump() for f in review],
            "required_role": "supervisor",
            "required_approver": SUPERVISOR,
            "created_at": now,
            "expires_at": now + self.settings.challenge_ttl_s,
            "status": "pending",
        }
        s.challenges[ch["challenge_id"]] = ch
        return ch

    # ------------------------------------------------------------------ challenge flow
    def approve(self, s: Session, challenge_id: str, approver_id: str, approver_role: str, reviewed_fingerprint: str, justification: str, credential: str) -> dict[str, Any]:
        with s.lock:
            ch = s.challenges.get(challenge_id)
            if ch is None:
                raise GatewayError(404, "challenge_not_found", "No such challenge in this session.")
            if not credential or not hmac.compare_digest(credential, s.supervisor_token):
                self.audit.append("challenge.approval_denied", s.id, challenge_id, {"reason": "missing or invalid supervisor credential", "approver_id": approver_id})
                raise GatewayError(403, "supervisor_credential_required", "A valid supervisor credential is required to approve.")
            if approver_role != ch["required_role"]:
                raise GatewayError(403, "wrong_role", f"Approval requires role {ch['required_role']}.")
            if approver_id in (ch["intent_operator"], ch["agent_id"]):
                raise GatewayError(403, "separation_of_duties", "The requester cannot approve their own exception.")
            now = time.time()
            if ch["status"] != "pending":
                raise GatewayError(409, "challenge_not_pending", f"Challenge is {ch['status']}.")
            if now > ch["expires_at"]:
                ch["status"] = "expired"
                raise GatewayError(410, "challenge_expired", "The review window has closed.")
            if reviewed_fingerprint != ch["fingerprint"]:
                raise GatewayError(409, "fingerprint_mismatch", "The reviewed action does not match the pending action.")
            grant = {
                "grant_id": new_id("grt"),
                "challenge_id": challenge_id,
                "action_id": ch["action_id"],
                "fingerprint": ch["fingerprint"],
                "intent_id": ch["intent_id"],
                "intent_version": ch["intent_version"],
                "approved_codes": ch["review_codes"],
                "approver_id": approver_id,
                "iat": now,
                "exp": now + self.settings.approval_ttl_s,
                "nonce": secrets.token_hex(12),
            }
            body = base64.urlsafe_b64encode(canonical_json(grant).encode()).decode().rstrip("=")
            token = body + "." + hmac_hex(self.settings.signing_key, body)
            ch["status"] = "approved"
            ch["approved_by"] = approver_id
            ch["approved_at"] = now
            ch["grant_id"] = grant["grant_id"]
            ch["justification"] = justification
            a = self.audit.append("challenge.approved", s.id, challenge_id, {"grant_id": grant["grant_id"], "approver_id": approver_id, "fingerprint": ch["fingerprint"], "expires_at": grant["exp"], "justification": justification})
        self.sessions.publish(s, {"type": "challenge", "challenge_id": challenge_id, "status": "approved"})
        return {"grant": token, "grant_id": grant["grant_id"], "expires_at": grant["exp"], "ttl_s": self.settings.approval_ttl_s, "audit": a}

    def reject(self, s: Session, challenge_id: str, approver_id: str, reason: str, credential: str) -> dict[str, Any]:
        with s.lock:
            ch = s.challenges.get(challenge_id)
            if ch is None:
                raise GatewayError(404, "challenge_not_found", "No such challenge in this session.")
            if not credential or not hmac.compare_digest(credential, s.supervisor_token):
                raise GatewayError(403, "supervisor_credential_required", "A valid supervisor credential is required.")
            if ch["status"] != "pending":
                raise GatewayError(409, "challenge_not_pending", f"Challenge is {ch['status']}.")
            ch["status"] = "rejected"
            dec = s.decisions.get(ch["decision_id"])
            if dec is not None:
                dec.status = "rejected"
            a = self.audit.append("challenge.rejected", s.id, challenge_id, {"approver_id": approver_id, "reason": reason})
        self.sessions.publish(s, {"type": "challenge", "challenge_id": challenge_id, "status": "rejected"})
        return {"status": "rejected", "audit": a}

    def execute_with_grant(self, s: Session, action_id: str, grant_token: str) -> dict[str, Any]:
        with s.lock:
            try:
                body, sig = grant_token.rsplit(".", 1)
            except ValueError:
                raise GatewayError(400, "malformed_grant", "Malformed approval grant.")
            if not hmac.compare_digest(hmac_hex(self.settings.signing_key, body), sig):
                self.audit.append("grant.rejected", s.id, action_id, {"reason": "bad signature"})
                raise GatewayError(403, "invalid_grant", "Approval grant signature is invalid.")
            g = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
            now = time.time()
            if g["nonce"] in s.used_grant_nonces:
                self.audit.append("grant.replay_rejected", s.id, action_id, {"grant_id": g["grant_id"]})
                raise GatewayError(409, "grant_replayed", "This approval was already used. Approvals are single-use.")
            if now > g["exp"]:
                self.audit.append("grant.rejected", s.id, action_id, {"grant_id": g["grant_id"], "reason": "expired"})
                raise GatewayError(410, "grant_expired", "The approval has expired; request a new review.")
            if g["action_id"] != action_id:
                self.audit.append("grant.rejected", s.id, action_id, {"grant_id": g["grant_id"], "reason": "bound to a different action", "bound_action": g["action_id"]})
                raise GatewayError(409, "grant_action_mismatch", "This approval is bound to a different action. A changed action needs its own review.")
            dec_id = s.actions.get(action_id)
            dec = s.decisions.get(dec_id) if dec_id else None
            if dec is None:
                raise GatewayError(404, "action_not_found", "Unknown action.")
            action = dec.action
            if action.fingerprint != g["fingerprint"] or action_fingerprint(action) != g["fingerprint"]:
                self.audit.append("grant.rejected", s.id, action_id, {"grant_id": g["grant_id"], "reason": "fingerprint mismatch"})
                raise GatewayError(409, "action_mutated", "The action changed after approval.")
            ch = s.challenges.get(g["challenge_id"])
            if ch is None or ch["status"] != "approved" or ch.get("grant_id") != g["grant_id"]:
                raise GatewayError(409, "challenge_not_approved", "No matching approved challenge.")
            intent = s.intents.get(action.intent_id, action.intent_version)
            latest = s.intents.latest_version(action.intent_id)
            sig_ok = intent is not None and s.intents.verify(intent)
            pr = self.policy.evaluate(action, intent, sig_ok, latest, s.world, now, approved_codes=set(g["approved_codes"]))
            if action.fingerprint in s.world.executed_fingerprints:
                pr.verdict = Verdict.BLOCK
            if pr.verdict != Verdict.ALLOW:
                ch["status"] = "refused"
                problems = [f.model_dump() for f in pr.findings if f.outcome in ("block", "challenge")]
                self.audit.append("execution.refused", s.id, action_id, {"grant_id": g["grant_id"], "findings": [p["code"] for p in problems]})
                raise GatewayError(409, "revalidation_failed", "Conditions changed since approval; hard policy re-check failed.", problems)
            execution = s.world.execute(action)
            s.world.executed_fingerprints.add(action.fingerprint)
            s.used_grant_nonces.add(g["nonce"])
            ch["status"] = "executed"
            dec.status = "executed"
            dec.executed_route = execution.get("route")
            a = self.audit.append("action.executed", s.id, action_id, {"decision_id": dec.decision_id, "grant_id": g["grant_id"], "approver_id": g["approver_id"], "execution": execution, "revalidated": True})
        self.sessions.publish(s, {"type": "execution", "action_id": action_id, "state_version": s.world.version})
        return {"status": "executed", "execution": execution, "revalidation": [f.model_dump() for f in pr.findings], "audit": a}
