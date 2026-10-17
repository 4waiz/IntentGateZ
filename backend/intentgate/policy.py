"""Hard policy engine.

Each check produces a Finding. Any `block` finding forces BLOCK and any `challenge` finding
forces at least CHALLENGE; the ML model can escalate but never relax these outcomes.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from .agents import AGENTS, TOOL_FOR_OPERATION, AgentIdentity
from .injection import InjectionDetector
from .schemas import (
    SECURITY_RELEVANT_FIELDS,
    AgentAction,
    Finding,
    HumanIntent,
    OperationType,
    TrustBoundary,
    TrustLevel,
    Verdict,
)
from .simulation import SUPPLIERS, SUPPLY_CATALOG, SimulationWorld

ICU_IMPACT_SHARE = 0.25  # reserving more than a quarter of free city ICU beds needs review
PRICE_ANOMALY_RATIO = 1.35
RATE_WINDOW_S = 60.0
RATE_MAX_ACTIONS = 6
INJECTION_BLOCK_SCORE = 0.80


@dataclass
class PolicyResult:
    findings: list[Finding]
    verdict: Verdict
    trust_boundary: TrustBoundary | None
    context: dict[str, Any] = field(default_factory=dict)


def _f(code: str, check: str, outcome: str, message: str, **evidence: Any) -> Finding:
    return Finding(code=code, check=check, outcome=outcome, message=message, evidence=evidence)


class PolicyEngine:
    def __init__(self, injection: InjectionDetector) -> None:
        self.injection = injection

    def evaluate(
        self,
        action: AgentAction,
        intent: HumanIntent | None,
        intent_signature_ok: bool,
        latest_version: int | None,
        world: SimulationWorld,
        now: float | None = None,
        approved_codes: set[str] | None = None,
    ) -> PolicyResult:
        now = time.time() if now is None else now
        approved_codes = approved_codes or set()
        out: list[Finding] = []
        ctx: dict[str, Any] = {}
        p = action.parameters
        t = action.action_type

        # ---------------------------------------------------------- identity & capability
        agent: AgentIdentity | None = AGENTS.get(action.agent_id)
        if agent is None or not agent.active:
            out.append(_f("IG-ID-001", "Agent identity", "block", "Unknown or inactive agent identity.", agent_id=action.agent_id))
        else:
            out.append(_f("IG-ID-001", "Agent identity", "pass", f"Authenticated agent {agent.name}.", agent_id=agent.agent_id))
            if t not in agent.capabilities:
                out.append(_f("IG-ID-002", "Tool capability", "block", f"{agent.name} is not provisioned for {t.value}.", capabilities=sorted(c.value for c in agent.capabilities)))
            elif action.tool != TOOL_FOR_OPERATION[t]:
                out.append(_f("IG-ID-002", "Tool capability", "block", f"Tool {action.tool} does not implement {t.value}.", expected_tool=TOOL_FOR_OPERATION[t]))
            else:
                out.append(_f("IG-ID-002", "Tool capability", "pass", f"Agent holds capability {t.value} via {action.tool}."))

        # ---------------------------------------------------------- human intent
        if intent is None:
            out.append(_f("IG-INT-001", "Registered intent", "block", "No registered human intent with this id and version.", intent_id=action.intent_id, version=action.intent_version))
            return self._finish(out, None, ctx)
        if not intent_signature_ok:
            out.append(_f("IG-INT-001", "Registered intent", "block", "Intent signature failed verification.", intent_id=intent.intent_id))
            return self._finish(out, None, ctx)
        out.append(_f("IG-INT-001", "Registered intent", "pass", f"Intent {intent.intent_id} v{intent.version} signature verified.", operator=intent.operator_id))
        if latest_version is not None and intent.version != latest_version:
            out.append(_f("IG-INT-002", "Intent version", "block", f"Action targets stale intent v{intent.version}; current version is v{latest_version}.", latest_version=latest_version))
        if now > intent.expires_at:
            out.append(_f("IG-INT-003", "Intent expiry", "block", "The human intent has expired.", expired_seconds_ago=round(now - intent.expires_at, 1)))
        else:
            out.append(_f("IG-INT-003", "Intent expiry", "pass", f"Intent valid for another {int((intent.expires_at - now) / 60)} min."))
        if t not in intent.authorized_operations:
            out.append(
                _f(
                    "IG-INT-004",
                    "Operation within intent",
                    "block",
                    f"The operator authorised {', '.join(o.value for o in intent.authorized_operations)}, not {t.value}.",
                    authorized=[o.value for o in intent.authorized_operations],
                    requested=t.value,
                )
            )
        else:
            out.append(_f("IG-INT-004", "Operation within intent", "pass", f"{t.value} was authorised by the operator."))

        scope_violations = self._scope_violations(action, intent)
        ctx["scope_violations"] = scope_violations
        if scope_violations:
            out.append(_f("IG-INT-005", "Targets within intent", "block", "Action touches entities the operator did not authorise.", violations=scope_violations))
        else:
            out.append(_f("IG-INT-005", "Targets within intent", "pass", "All targeted entities are inside the authorised scope."))

        # ---------------------------------------------------------- operational checks
        if t in (OperationType.REROUTE_AMBULANCE, OperationType.DISPATCH_AMBULANCE):
            out += self._routing_checks(action, intent, world, ctx)
        elif t == OperationType.RESERVE_ICU_BEDS:
            out += self._icu_checks(action, intent, world, ctx)
        elif t == OperationType.PURCHASE_SUPPLIES:
            out += self._financial_checks(action, intent, world, ctx, approved_codes)
        elif t == OperationType.UPDATE_HOSPITAL_STATUS:
            if p["hospital_id"] not in world.hospitals:
                out.append(_f("IG-OPS-001", "Destination validity", "block", "Unknown hospital.", hospital_id=p["hospital_id"]))
            elif p["status"] == "diverting":
                out.append(_f("IG-OPS-007", "Diversion impact", "challenge", "Diverting a hospital removes city-wide emergency capacity and needs supervisor review.", hospital_id=p["hospital_id"]))
        elif t == OperationType.SHARE_PATIENT_RECORD:
            recipient = p["recipient"].lower()
            internal = any(h in recipient for h in world.hospitals) and "@" not in recipient
            if not internal:
                out.append(_f("IG-DATA-001", "Patient data egress", "block", "Patient records may only be shared with in-network hospitals.", recipient=p["recipient"]))
            else:
                out.append(_f("IG-DATA-001", "Patient data egress", "pass", "Recipient is an in-network facility."))
        elif t == OperationType.CANCEL_DISPATCH:
            amb = world.ambulances.get(p["ambulance_id"])
            if amb is None:
                out.append(_f("IG-OPS-001", "Unit validity", "block", "Unknown ambulance.", ambulance_id=p["ambulance_id"]))
            elif amb.patient:
                out.append(_f("IG-OPS-008", "Patient on board", "block", "Cannot cancel a unit that is transporting a patient.", ambulance_id=amb.id))

        # ---------------------------------------------------------- behaviour
        recent = world.recent_history(action.agent_id, now, RATE_WINDOW_S)
        ctx["recent_count"] = len(recent)
        if len(recent) >= RATE_MAX_ACTIONS:
            out.append(_f("IG-RATE-001", "Agent action rate", "challenge", f"{len(recent)} actions from this agent in the last minute.", window_s=RATE_WINDOW_S))

        # ---------------------------------------------------------- trust boundary
        tb, tb_findings = self._trust_boundary(action, intent, scope_violations)
        out += tb_findings
        return self._finish(out, tb, ctx)

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _finish(out: list[Finding], tb: TrustBoundary | None, ctx: dict[str, Any]) -> PolicyResult:
        verdict = Verdict.ALLOW
        for f in out:
            if f.outcome == "block":
                verdict = Verdict.BLOCK
                break
            if f.outcome == "challenge":
                verdict = Verdict.CHALLENGE
        return PolicyResult(out, verdict, tb, ctx)

    @staticmethod
    def _scope_violations(action: AgentAction, intent: HumanIntent) -> list[dict[str, str]]:
        p = action.parameters
        pt = intent.permitted_targets
        checks = [
            ("ambulance_id", pt.ambulances),
            ("destination_hospital_id", pt.hospitals),
            ("hospital_id", pt.hospitals),
            ("delivery_hospital_id", pt.hospitals),
            ("supplier_id", pt.suppliers),
            ("incident_id", pt.incidents),
        ]
        out = []
        for key, allowed in checks:
            val = p.get(key)
            if val is None:
                continue
            if allowed and val not in allowed:
                out.append({"field": key, "value": str(val), "allowed": ", ".join(allowed)})
            elif not allowed and key in ("ambulance_id", "destination_hospital_id", "hospital_id", "supplier_id"):
                out.append({"field": key, "value": str(val), "allowed": "(none authorised)"})
        return out

    def _routing_checks(self, action: AgentAction, intent: HumanIntent, world: SimulationWorld, ctx: dict[str, Any]) -> list[Finding]:
        out: list[Finding] = []
        p = action.parameters
        amb = world.ambulances.get(p["ambulance_id"])
        hosp = world.city.hospitals.get(p["destination_hospital_id"])
        if amb is None:
            out.append(_f("IG-OPS-001", "Unit validity", "block", "Unknown ambulance.", ambulance_id=p["ambulance_id"]))
            return out
        if hosp is None:
            out.append(_f("IG-OPS-001", "Destination validity", "block", "Destination hospital does not exist.", hospital_id=p["destination_hospital_id"]))
            return out
        hs = world.hospitals[hosp.id]
        snap = world.hospital_snapshot(hosp.id)
        ctx["destination"] = snap
        if hs.status != "accepting" and intent.routing.require_accepting_hospital:
            out.append(_f("IG-OPS-001", "Destination validity", "block", f"{hosp.name} is {hs.status} ({hs.status_reason}).", hospital=snap))
        else:
            out.append(_f("IG-OPS-001", "Destination validity", "pass", f"{hosp.name} is accepting patients.", hospital_id=hosp.id))
        incident_id = p.get("incident_id")
        specialty = world.incidents[incident_id].required_specialty if incident_id in world.incidents else None
        if action.action_type == OperationType.DISPATCH_AMBULANCE and incident_id not in world.incidents:
            out.append(_f("IG-OPS-001", "Incident validity", "block", "Unknown incident.", incident_id=incident_id))
        if specialty and specialty not in hosp.specialties:
            out.append(_f("IG-OPS-002", "Clinical capability", "block", f"{hosp.name} has no {specialty} capability.", specialties=list(hosp.specialties), required=specialty))
        elif specialty:
            out.append(_f("IG-OPS-002", "Clinical capability", "pass", f"{hosp.name} provides {specialty} care."))
        if hs.beds_available <= 0:
            out.append(_f("IG-OPS-003", "Hospital capacity", "block", f"{hosp.name} has no free beds.", beds_available=hs.beds_available))
        else:
            out.append(_f("IG-OPS-003", "Hospital capacity", "pass", f"{hs.beds_available} beds available.", beds_available=hs.beds_available))

        route = p.get("route")
        start, _ = world.current_anchor(amb)
        ctx["anchor"] = start
        if action.action_type == OperationType.DISPATCH_AMBULANCE and incident_id in world.incidents:
            best_a = world.route_for(start, world.incidents[incident_id].node)
            best_b = world.route_for(world.incidents[incident_id].node, hosp.node)
            best_t = (best_a[2] if best_a else float("inf")) + (best_b[2] if best_b else float("inf"))
        else:
            best = world.route_for(start, hosp.node)
            best_t = best[2] if best else float("inf")
        if route:
            m = world.city.route_metrics(route, set(world.closures))
            ctx["route_metrics"] = m
            if not m["valid"]:
                out.append(_f("IG-OPS-005", "Route integrity", "block", "Route contains road segments that do not exist.", detail=m.get("reason")))
            else:
                problems = []
                if route[0] != start:
                    problems.append(f"route starts at {route[0]} but the unit's next node is {start}")
                if route[-1] != hosp.node:
                    problems.append("route does not end at the destination hospital")
                if m["closed_edges"] and intent.routing.avoid_closed_roads:
                    out.append(_f("IG-OPS-005", "Route integrity", "block", "Route uses closed roads.", closed_edges=m["closed_edges"]))
                elif problems:
                    out.append(_f("IG-OPS-005", "Route integrity", "block", "; ".join(problems)))
                else:
                    out.append(_f("IG-OPS-005", "Route integrity", "pass", f"Route of {m['distance_m'] / 1000:.2f} km avoids all closures.", eta_min=m["eta_min"]))
                eta = m["eta_min"]
                ctx["eta_min"] = eta
                ctx["eta_ratio"] = (eta * 60) / best_t if best_t not in (0, float("inf")) else 1.0
                if intent.routing.max_eta_min and eta > intent.routing.max_eta_min:
                    out.append(_f("IG-OPS-006", "ETA limit", "challenge", f"ETA {eta:.1f} min exceeds the operator's {intent.routing.max_eta_min:g} min limit.", eta_min=eta))
                elif intent.routing.max_eta_min:
                    out.append(_f("IG-OPS-006", "ETA limit", "pass", f"ETA {eta:.1f} min within {intent.routing.max_eta_min:g} min.", eta_min=eta))
        else:
            ctx["eta_ratio"] = 1.0
            if best_t == float("inf"):
                out.append(_f("IG-OPS-005", "Route integrity", "block", "No open route to the destination."))
        return out

    def _icu_checks(self, action: AgentAction, intent: HumanIntent, world: SimulationWorld, ctx: dict[str, Any]) -> list[Finding]:
        out: list[Finding] = []
        p = action.parameters
        hs = world.hospitals.get(p["hospital_id"])
        if hs is None:
            return [_f("IG-OPS-001", "Destination validity", "block", "Unknown hospital.", hospital_id=p["hospital_id"])]
        ctx["destination"] = world.hospital_snapshot(hs.id)
        if p["beds"] > hs.icu_available:
            out.append(_f("IG-OPS-003", "ICU capacity", "block", f"Requested {p['beds']} ICU beds but only {hs.icu_available} are free.", icu_available=hs.icu_available))
        else:
            out.append(_f("IG-OPS-003", "ICU capacity", "pass", f"{hs.icu_available} ICU beds free.", icu_available=hs.icu_available))
        limit = intent.resource_limits.max_icu_beds
        if limit is not None and p["beds"] > limit:
            out.append(_f("IG-INT-006", "Resource limit", "block", f"Operator limited reservations to {limit} beds; agent requested {p['beds']}.", limit=limit))
        total_free = max(1, world.total_icu_available())
        share = p["beds"] / total_free
        ctx["icu_share"] = share
        if share > ICU_IMPACT_SHARE:
            out.append(_f("IG-OPS-004", "City-wide ICU impact", "challenge", f"Reservation would consume {share:.0%} of free ICU beds in the city.", share=round(share, 3)))
        return out

    def _financial_checks(self, action: AgentAction, intent: HumanIntent, world: SimulationWorld, ctx: dict[str, Any], approved_codes: set[str]) -> list[Finding]:
        out: list[Finding] = []
        p = action.parameters
        if p["supplier_id"] not in SUPPLIERS:
            out.append(_f("IG-FIN-005", "Supplier registry", "block", "Supplier is not in the approved vendor registry.", supplier_id=p["supplier_id"]))
        cat = SUPPLY_CATALOG.get(p["item_sku"])
        if cat is None:
            out.append(_f("IG-FIN-001", "Parameter consistency", "block", "Unknown catalogue item.", item_sku=p["item_sku"]))
            return out
        if abs(p["quantity"] * p["unit_price_usd"] - p["total_usd"]) > 0.01 * max(1.0, p["total_usd"]):
            out.append(_f("IG-FIN-001", "Parameter consistency", "block", "quantity x unit price does not equal the order total.", computed=round(p["quantity"] * p["unit_price_usd"], 2), total_usd=p["total_usd"]))
        else:
            out.append(_f("IG-FIN-001", "Parameter consistency", "pass", "Order arithmetic is consistent."))
        price_ratio = p["unit_price_usd"] / cat["unit_price_usd"]
        ctx["price_ratio"] = price_ratio
        if price_ratio > PRICE_ANOMALY_RATIO:
            out.append(_f("IG-FIN-003", "Price anomaly", "challenge", f"Unit price is {price_ratio:.2f}x the catalogue price.", catalogue_price=cat["unit_price_usd"]))
        fin = intent.financial
        if fin is None:
            out.append(_f("IG-FIN-002", "Spending authority", "block", "The intent grants no spending authority."))
            return out
        total = p["total_usd"]
        ctx["budget_ratio"] = total / fin.budget_usd if fin.budget_usd else float("inf")
        if total > fin.escalation_ceiling_usd:
            out.append(_f("IG-FIN-002", "Spending authority", "block", f"${total:,.0f} exceeds the hard ceiling of ${fin.escalation_ceiling_usd:,.0f}; no approval path exists.", authorized_usd=fin.budget_usd, ceiling_usd=fin.escalation_ceiling_usd, requested_usd=total))
        elif total > fin.budget_usd:
            outcome = "pass" if "IG-FIN-002" in approved_codes else "challenge"
            out.append(
                _f(
                    "IG-FIN-002",
                    "Spending authority",
                    outcome,
                    f"${total:,.0f} exceeds the operator's authorised ${fin.budget_usd:,.0f}; a {fin.approver_role} may approve up to ${fin.escalation_ceiling_usd:,.0f}."
                    + (" Approved by supervisor." if outcome == "pass" else ""),
                    authorized_usd=fin.budget_usd,
                    ceiling_usd=fin.escalation_ceiling_usd,
                    requested_usd=total,
                    approver_role=fin.approver_role,
                )
            )
        else:
            out.append(_f("IG-FIN-002", "Spending authority", "pass", f"${total:,.0f} is within the authorised ${fin.budget_usd:,.0f}.", authorized_usd=fin.budget_usd, requested_usd=total))
        prior = world.spend_for_intent(intent.intent_id)
        cum = prior + total
        ctx["cum_spend_ratio"] = cum / fin.budget_usd if fin.budget_usd else float("inf")
        if prior > 0 and cum > fin.escalation_ceiling_usd:
            out.append(_f("IG-FIN-004", "Cumulative spend", "block", f"Cumulative spend ${cum:,.0f} under this intent would exceed the ${fin.escalation_ceiling_usd:,.0f} ceiling.", prior_usd=prior))
        elif prior > 0 and cum > fin.budget_usd and total <= fin.budget_usd:
            outcome = "pass" if "IG-FIN-004" in approved_codes else "challenge"
            out.append(_f("IG-FIN-004", "Cumulative spend", outcome, f"Cumulative spend ${cum:,.0f} exceeds the authorised ${fin.budget_usd:,.0f} (possible order splitting).", prior_usd=prior))
        return out

    def _trust_boundary(self, action: AgentAction, intent: HumanIntent, scope_violations: list[dict[str, str]]) -> tuple[TrustBoundary | None, list[Finding]]:
        untrusted = [pv for pv in action.provenance if pv.trust == TrustLevel.UNTRUSTED]
        if not untrusted:
            return None, [_f("IG-TRUST-001", "Trust boundary", "pass", "No untrusted source influenced this action.")]
        sec_fields = sorted({f for pv in untrusted for f in pv.influenced_fields if f in SECURITY_RELEVANT_FIELDS})
        out_of_scope_fields = {v["field"] for v in scope_violations}
        conflicting = sorted(set(sec_fields) & out_of_scope_fields)
        inj = max((self.injection.score(pv.excerpt) for pv in untrusted), default=0.0)
        sources = [pv.source_id for pv in untrusted]
        if sec_fields and (conflicting or inj >= INJECTION_BLOCK_SCORE):
            reason = []
            if conflicting:
                reason.append(f"untrusted content set {', '.join(conflicting)} to values outside the operator's intent")
            if inj >= INJECTION_BLOCK_SCORE:
                reason.append(f"untrusted content contains agent-directed instructions (injection score {inj:.2f})")
            tb = TrustBoundary(
                crossed=True,
                untrusted_sources=sources,
                influenced_fields=sec_fields,
                description="External feed -> agent planner -> privileged tool call: " + "; ".join(reason) + ".",
            )
            return tb, [_f("IG-TRUST-001", "Trust boundary", "block", "Untrusted input crossed into a privileged action.", sources=sources, fields=sec_fields, injection_score=round(inj, 3))]
        tb = TrustBoundary(
            crossed=False,
            untrusted_sources=sources,
            influenced_fields=sec_fields,
            description="Untrusted information was used as context only; resulting values stay inside the operator's intent.",
        )
        return tb, [_f("IG-TRUST-001", "Trust boundary", "info", "Untrusted context used, but values stay within intent.", sources=sources, injection_score=round(inj, 3))]
