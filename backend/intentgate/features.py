"""Contextual feature extraction shared by training (ml/) and serving (gateway).

Every feature is computable before the security decision from the registered intent, the
proposed action, the live simulation state and the agent's recent history. None of them is
derived from the label.
"""

from __future__ import annotations

import math
import re
import time
from typing import Any

from .agents import AGENTS, TOOL_FOR_OPERATION
from .injection import InjectionDetector, imperative_density, lexical_hits
from .schemas import SECURITY_RELEVANT_FIELDS, AgentAction, HumanIntent, OperationType, TrustLevel
from .simulation import SUPPLIERS, SimulationWorld

OPS = [
    OperationType.REROUTE_AMBULANCE,
    OperationType.DISPATCH_AMBULANCE,
    OperationType.RESERVE_ICU_BEDS,
    OperationType.PURCHASE_SUPPLIES,
    OperationType.UPDATE_HOSPITAL_STATUS,
    OperationType.SHARE_PATIENT_RECORD,
    OperationType.CANCEL_DISPATCH,
]

FEATURE_NAMES = [
    "agent_known",
    "capability_match",
    "tool_match",
    "intent_present",
    "intent_stale",
    "intent_age_frac",
    "op_in_intent",
    "scope_violations",
    "dest_accepting",
    "specialty_match",
    "capacity_ok",
    "icu_share",
    "route_invalid",
    "route_closed_edges",
    "eta_ratio",
    "eta_over_limit",
    "amount_log10",
    "budget_ratio",
    "over_budget",
    "over_ceiling",
    "price_ratio",
    "params_inconsistent",
    "cum_spend_ratio",
    "n_untrusted_sources",
    "untrusted_security_fields",
    "injection_score",
    "rationale_injection_score",
    "lexical_hits",
    "imperative_density",
    "entity_alignment",
    "text_similarity",
    "param_change_count",
    "recent_actions_10m",
    "recent_high_value_10m",
    "agent_prior_blocks",
    "phi_egress",
] + [f"op_{o.value}" for o in OPS]

_STOP = set(
    "a an the to of for and or in on at by with from as is are be this that it its into via per all any our your their"
    " please now then also only them they we i".split()
)


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9']+", (text or "").lower()) if t not in _STOP and len(t) > 1}


def _entity_names(world: SimulationWorld, p: dict[str, Any]) -> list[str]:
    names = []
    for key in ("destination_hospital_id", "hospital_id", "delivery_hospital_id"):
        if p.get(key) in world.city.hospitals:
            names.append(world.city.hospitals[p[key]].name)
    if p.get("ambulance_id") in world.ambulances:
        names.append(world.ambulances[p["ambulance_id"]].call_sign)
    if p.get("supplier_id") in SUPPLIERS:
        names.append(SUPPLIERS[p["supplier_id"]])
    if p.get("incident_id") in world.incidents:
        names.append(p["incident_id"])
    return names


def _clip(v: float, lo: float, hi: float) -> float:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return lo
    return max(lo, min(hi, v))


def extract(
    action: AgentAction,
    intent: HumanIntent | None,
    latest_version: int | None,
    world: SimulationWorld,
    policy_ctx: dict[str, Any],
    injection: InjectionDetector,
    now: float | None = None,
) -> dict[str, float]:
    now = time.time() if now is None else now
    p = action.parameters
    t = action.action_type
    agent = AGENTS.get(action.agent_id)
    f: dict[str, float] = {k: 0.0 for k in FEATURE_NAMES}

    f["agent_known"] = 1.0 if agent else 0.0
    f["capability_match"] = 1.0 if agent and t in agent.capabilities else 0.0
    f["tool_match"] = 1.0 if action.tool == TOOL_FOR_OPERATION[t] else 0.0
    if intent is not None:
        f["intent_present"] = 1.0
        f["intent_stale"] = 1.0 if latest_version is not None and intent.version != latest_version else 0.0
        span = max(1.0, intent.expires_at - intent.created_at)
        f["intent_age_frac"] = _clip((now - intent.created_at) / span, 0.0, 2.0)
        f["op_in_intent"] = 1.0 if t in intent.authorized_operations else 0.0
    f["scope_violations"] = float(len(policy_ctx.get("scope_violations", [])))

    dest = policy_ctx.get("destination")
    f["dest_accepting"] = 1.0 if (dest is None or dest.get("status") == "accepting") else 0.0
    f["specialty_match"] = 1.0
    if t in (OperationType.REROUTE_AMBULANCE, OperationType.DISPATCH_AMBULANCE) and dest is not None:
        inc = world.incidents.get(p.get("incident_id") or "")
        if inc is not None and inc.required_specialty not in dest.get("specialties", []):
            f["specialty_match"] = 0.0
    f["capacity_ok"] = 1.0
    if dest is not None:
        if t == OperationType.RESERVE_ICU_BEDS:
            f["capacity_ok"] = 1.0 if p["beds"] <= dest.get("icu_available", 0) else 0.0
        elif t in (OperationType.REROUTE_AMBULANCE, OperationType.DISPATCH_AMBULANCE):
            f["capacity_ok"] = 1.0 if dest.get("beds_available", 0) > 0 else 0.0
    f["icu_share"] = _clip(policy_ctx.get("icu_share", 0.0), 0.0, 5.0)

    rm = policy_ctx.get("route_metrics")
    if rm is not None:
        f["route_invalid"] = 0.0 if rm.get("valid") else 1.0
        f["route_closed_edges"] = float(len(rm.get("closed_edges", [])))
    f["eta_ratio"] = _clip(policy_ctx.get("eta_ratio", 1.0), 0.0, 5.0)
    if intent is not None and intent.routing.max_eta_min and policy_ctx.get("eta_min"):
        f["eta_over_limit"] = 1.0 if policy_ctx["eta_min"] > intent.routing.max_eta_min else 0.0

    total = float(p.get("total_usd") or 0.0)
    f["amount_log10"] = math.log10(1.0 + total)
    if t == OperationType.PURCHASE_SUPPLIES:
        fin = intent.financial if intent is not None else None
        if fin is not None and fin.budget_usd > 0:
            f["budget_ratio"] = _clip(total / fin.budget_usd, 0.0, 50.0)
            f["over_budget"] = 1.0 if total > fin.budget_usd else 0.0
            f["over_ceiling"] = 1.0 if total > fin.escalation_ceiling_usd else 0.0
        else:
            f["budget_ratio"] = 50.0
            f["over_budget"] = 1.0
            f["over_ceiling"] = 1.0
        f["price_ratio"] = _clip(policy_ctx.get("price_ratio", 1.0), 0.0, 10.0)
        f["params_inconsistent"] = 1.0 if abs(p["quantity"] * p["unit_price_usd"] - total) > 0.01 * max(1.0, total) else 0.0
        f["cum_spend_ratio"] = _clip(policy_ctx.get("cum_spend_ratio", f["budget_ratio"]), 0.0, 50.0)
    else:
        f["price_ratio"] = 1.0

    untrusted = [pv for pv in action.provenance if pv.trust == TrustLevel.UNTRUSTED]
    f["n_untrusted_sources"] = float(len(untrusted))
    f["untrusted_security_fields"] = float(len({x for pv in untrusted for x in pv.influenced_fields if x in SECURITY_RELEVANT_FIELDS}))
    f["injection_score"] = max((injection.score(pv.excerpt) for pv in untrusted), default=0.0)
    f["rationale_injection_score"] = injection.score(action.rationale)
    all_text = " ".join([pv.excerpt for pv in action.provenance if pv.trust != TrustLevel.TRUSTED] + [action.rationale])
    f["lexical_hits"] = float(lexical_hits(all_text))
    f["imperative_density"] = imperative_density(" ".join(pv.excerpt for pv in untrusted))

    if intent is not None:
        intent_tokens = _tokens(intent.instruction)
        allowed_names = []
        for hid in intent.permitted_targets.hospitals:
            if hid in world.city.hospitals:
                allowed_names.append(world.city.hospitals[hid].name)
        for aid in intent.permitted_targets.ambulances:
            if aid in world.ambulances:
                allowed_names.append(world.ambulances[aid].call_sign)
        for sid in intent.permitted_targets.suppliers:
            allowed_names.append(SUPPLIERS.get(sid, sid))
        allowed_tokens = intent_tokens | _tokens(" ".join(allowed_names) + " " + " ".join(intent.permitted_targets.incidents))
        ent_tokens = _tokens(" ".join(_entity_names(world, p)))
        f["entity_alignment"] = len(ent_tokens & allowed_tokens) / len(ent_tokens) if ent_tokens else 1.0
        rt = _tokens(action.rationale)
        f["text_similarity"] = len(rt & intent_tokens) / len(rt | intent_tokens) if (rt or intent_tokens) else 0.0

    prev = [h for h in world.history if h["agent_id"] == action.agent_id and h["intent_id"] == action.intent_id]
    if prev:
        last = prev[-1]["params"]
        keys = set(last) | set(p)
        f["param_change_count"] = float(sum(1 for k in keys if k != "route" and last.get(k) != p.get(k)))
    recent = world.recent_history(action.agent_id, now, 600.0)
    f["recent_actions_10m"] = float(len(recent))
    f["recent_high_value_10m"] = float(sum(1 for h in recent if h.get("amount", 0) > 10_000))
    f["agent_prior_blocks"] = float(sum(1 for h in world.history if h["agent_id"] == action.agent_id and h["verdict"] == "BLOCK"))
    if t == OperationType.SHARE_PATIENT_RECORD:
        rec = p["recipient"].lower()
        f["phi_egress"] = 0.0 if (any(h in rec for h in world.hospitals) and "@" not in rec) else 1.0
    f[f"op_{t.value}"] = 1.0
    return f


def vector(features: dict[str, float]) -> list[float]:
    return [float(features.get(k, 0.0)) for k in FEATURE_NAMES]
