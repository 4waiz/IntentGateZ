"""Agent identities, tool capabilities and the deterministic planning agents used in the demo.

The planners are deterministic programs, not language models. The "compromised" planner used
in the prompt-injection scenario is a test harness that deliberately follows instructions
found in untrusted feed text, so the gateway can be exercised against a realistic unsafe
proposal. Every proposal it produces is flagged `simulated_adversary=True`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .schemas import AgentActionIn, HumanIntent, OperationType, Provenance, SourceType, TrustLevel
from .simulation import SUPPLY_CATALOG, SimulationWorld

TOOL_FOR_OPERATION = {
    OperationType.REROUTE_AMBULANCE: "cad.route.set",
    OperationType.DISPATCH_AMBULANCE: "cad.unit.dispatch",
    OperationType.CANCEL_DISPATCH: "cad.unit.cancel",
    OperationType.RESERVE_ICU_BEDS: "bedreg.icu.reserve",
    OperationType.UPDATE_HOSPITAL_STATUS: "bedreg.status.set",
    OperationType.PURCHASE_SUPPLIES: "erp.purchase_order.create",
    OperationType.SHARE_PATIENT_RECORD: "ehr.record.share",
}


@dataclass(frozen=True)
class AgentIdentity:
    agent_id: str
    name: str
    role: str
    capabilities: frozenset[OperationType]
    description: str
    active: bool = True
    tools: frozenset[str] = field(default_factory=frozenset)

    def to_json(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "role": self.role,
            "capabilities": sorted(c.value for c in self.capabilities),
            "tools": sorted(self.tools),
            "description": self.description,
            "active": self.active,
        }


def _agent(agent_id: str, name: str, role: str, caps: set[OperationType], desc: str) -> AgentIdentity:
    return AgentIdentity(agent_id, name, role, frozenset(caps), desc, True, frozenset(TOOL_FOR_OPERATION[c] for c in caps))


AGENTS: dict[str, AgentIdentity] = {
    a.agent_id: a
    for a in [
        _agent(
            "route-planner-01",
            "Ambulance Routing Agent",
            "routing",
            {OperationType.REROUTE_AMBULANCE, OperationType.DISPATCH_AMBULANCE, OperationType.CANCEL_DISPATCH},
            "Plans ambulance dispatch and routes on the city road network.",
        ),
        _agent(
            "supply-agent-02",
            "Procurement Agent",
            "procurement",
            {OperationType.PURCHASE_SUPPLIES},
            "Raises purchase orders for emergency medical supplies.",
        ),
        _agent(
            "capacity-agent-03",
            "Hospital Coordination Agent",
            "coordination",
            {OperationType.RESERVE_ICU_BEDS, OperationType.UPDATE_HOSPITAL_STATUS, OperationType.SHARE_PATIENT_RECORD},
            "Coordinates ICU capacity, hospital status and record transfers.",
        ),
    ]
}


# ------------------------------------------------------------------ rationale formats
# The live planners and ml/generate_dataset.py share these, so the model is trained on the
# same text distribution it sees in production.


def reroute_rationale(call_sign: str, hospital: str, specialty: str, eta_min: float) -> str:
    return (
        f"Reroute {call_sign} around active closures to {hospital}, the fastest permitted "
        f"{specialty}-capable hospital that is accepting patients. Computed ETA {eta_min:.1f} min."
    )


def dispatch_rationale(call_sign: str, incident: str, hospital: str) -> str:
    return f"Dispatch {call_sign} to {incident} and transport to {hospital}."


def purchase_rationale(quantity: int, item: str, total: float, hospital_id: str, note: str) -> str:
    return f"Order {quantity} x {item} (${total:,.0f}) for {hospital_id}. {note}"


def icu_rationale(beds: int, hospital_id: str, hours: float) -> str:
    return f"Reserve {beds} ICU beds at {hospital_id} for {hours:g} h as instructed."


def injected_dispatch_rationale(call_sign: str, hospital: str) -> str:
    return f"Per updated regional notice, redirecting {call_sign} to {hospital} instead of the original destination."


# ------------------------------------------------------------------ routing planner


def best_hospital(world: SimulationWorld, start_node: str, candidates: list[str], specialty: str | None) -> tuple[str, list[str], float] | None:
    """Fastest accepting hospital with the specialty and free beds, among candidates."""
    best = None
    for hid in candidates:
        h = world.city.hospitals.get(hid)
        hs = world.hospitals.get(hid)
        if not h or not hs or hs.status != "accepting" or hs.beds_available <= 0:
            continue
        if specialty and specialty not in h.specialties:
            continue
        res = world.route_for(start_node, h.node)
        if not res:
            continue
        if best is None or res[2] < best[2]:
            best = (hid, res[0], res[2])
    return best


def plan_reroute(world: SimulationWorld, intent: HumanIntent, ambulance_id: str, incident_id: str | None) -> AgentActionIn:
    amb = world.ambulances[ambulance_id]
    start, _ = world.current_anchor(amb)
    specialty = world.incidents[incident_id].required_specialty if incident_id in world.incidents else None
    choice = best_hospital(world, start, list(intent.permitted_targets.hospitals), specialty)
    if choice is None:
        raise ValueError("no permitted hospital reachable")
    hid, route, t = choice
    closures = ", ".join(c.reason for c in world.closures.values()) or "none"
    return AgentActionIn(
        agent_id="route-planner-01",
        intent_id=intent.intent_id,
        intent_version=intent.version,
        action_type=OperationType.REROUTE_AMBULANCE,
        tool=TOOL_FOR_OPERATION[OperationType.REROUTE_AMBULANCE],
        target=ambulance_id,
        parameters={"ambulance_id": ambulance_id, "destination_hospital_id": hid, "incident_id": incident_id, "route": route},
        provenance=[
            Provenance(source_id=intent.operator_id, source_type=SourceType.OPERATOR, trust=TrustLevel.TRUSTED, influenced_fields=["ambulance_id", "destination_hospital_id"], excerpt=intent.instruction[:300]),
            Provenance(source_id="cad_road_status", source_type=SourceType.INTERNAL_SYSTEM, trust=TrustLevel.INTERNAL, influenced_fields=["route"], excerpt=f"Active closures: {closures}"),
            Provenance(source_id="bed_registry", source_type=SourceType.INTERNAL_SYSTEM, trust=TrustLevel.INTERNAL, influenced_fields=["destination_hospital_id"], excerpt="Accepting hospitals with free beds and matching specialty"),
        ],
        rationale=reroute_rationale(amb.call_sign, world.city.hospitals[hid].name, specialty or "general", t / 60),
        required_permissions=["cad.route.write"],
    )


def plan_dispatch(world: SimulationWorld, intent: HumanIntent, ambulance_id: str, incident_id: str, hospital_id: str | None = None, provenance_extra: list[Provenance] | None = None, rationale: str | None = None) -> AgentActionIn:
    amb = world.ambulances[ambulance_id]
    inc = world.incidents[incident_id]
    if hospital_id is None:
        choice = best_hospital(world, inc.node, list(intent.permitted_targets.hospitals), inc.required_specialty)
        if choice is None:
            raise ValueError("no permitted hospital available")
        hospital_id = choice[0]
    route = world.plan_dispatch_route(amb, inc, hospital_id)
    prov = [
        Provenance(source_id=intent.operator_id, source_type=SourceType.OPERATOR, trust=TrustLevel.TRUSTED, influenced_fields=["ambulance_id", "incident_id", "destination_hospital_id"], excerpt=intent.instruction[:300]),
        Provenance(source_id="cad_incident_board", source_type=SourceType.INTERNAL_SYSTEM, trust=TrustLevel.INTERNAL, influenced_fields=["incident_id", "route"], excerpt=f"{inc.id}: {inc.description}"),
    ] + (provenance_extra or [])
    return AgentActionIn(
        agent_id="route-planner-01",
        intent_id=intent.intent_id,
        intent_version=intent.version,
        action_type=OperationType.DISPATCH_AMBULANCE,
        tool=TOOL_FOR_OPERATION[OperationType.DISPATCH_AMBULANCE],
        target=ambulance_id,
        parameters={"ambulance_id": ambulance_id, "incident_id": incident_id, "destination_hospital_id": hospital_id, "route": route},
        provenance=prov,
        rationale=rationale or dispatch_rationale(amb.call_sign, inc.id, world.city.hospitals[hospital_id].name),
        required_permissions=["cad.dispatch.write"],
    )


# ------------------------------------------------------------------ adversarial harness

_HOSPITAL_ALIASES = {
    "eastfield": "hosp_eastfield",
    "riverside": "hosp_riverside",
    "aurelia": "hosp_aurelia",
    "harbor point": "hosp_harbor",
    "harbour point": "hosp_harbor",
    "northgate": "hosp_northgate",
}


def compromised_planner_dispatch(world: SimulationWorld, intent: HumanIntent, ambulance_id: str, incident_id: str, feed_item: dict) -> AgentActionIn:
    """SIMULATED ADVERSARIAL PROPOSAL.

    A deterministic stand-in for an LLM planner that was successfully prompt-injected: it
    reads the untrusted feed text and adopts the first redirect target it names. No language
    model is involved; this harness exists to test that the gateway stops such a proposal.
    """
    text = feed_item["text"].lower()
    target = None
    m = re.search(r"redirect[^.]*?to ([a-z' ]+?)(?: hospital| community| medical|\.|,)", text)
    if m:
        for alias, hid in _HOSPITAL_ALIASES.items():
            if alias in m.group(1):
                target = hid
                break
    if target is None:
        for alias, hid in _HOSPITAL_ALIASES.items():
            if alias in text and hid not in intent.permitted_targets.hospitals:
                target = hid
                break
    target = target or "hosp_eastfield"
    extra = [
        Provenance(
            source_id=feed_item["id"],
            source_type=SourceType.EXTERNAL_FEED,
            trust=TrustLevel.UNTRUSTED,
            influenced_fields=["destination_hospital_id"],
            excerpt=feed_item["text"][:600],
        )
    ]
    return plan_dispatch(
        world,
        intent,
        ambulance_id,
        incident_id,
        hospital_id=target,
        provenance_extra=extra,
        rationale=injected_dispatch_rationale(world.ambulances[ambulance_id].call_sign, world.city.hospitals[target].name),
    )


# ------------------------------------------------------------------ procurement & coordination


def plan_purchase(intent: HumanIntent, supplier_id: str, sku: str, quantity: int, delivery_hospital_id: str, forecast_note: str, unit_price: float | None = None) -> AgentActionIn:
    price = unit_price if unit_price is not None else SUPPLY_CATALOG[sku]["unit_price_usd"]
    total = round(price * quantity, 2)
    return AgentActionIn(
        agent_id="supply-agent-02",
        intent_id=intent.intent_id,
        intent_version=intent.version,
        action_type=OperationType.PURCHASE_SUPPLIES,
        tool=TOOL_FOR_OPERATION[OperationType.PURCHASE_SUPPLIES],
        target=supplier_id,
        parameters={
            "supplier_id": supplier_id,
            "item_sku": sku,
            "quantity": quantity,
            "unit_price_usd": price,
            "total_usd": total,
            "delivery_hospital_id": delivery_hospital_id,
        },
        provenance=[
            Provenance(source_id=intent.operator_id, source_type=SourceType.OPERATOR, trust=TrustLevel.TRUSTED, influenced_fields=["supplier_id", "item_sku", "delivery_hospital_id"], excerpt=intent.instruction[:300]),
            Provenance(source_id="inventory_forecast", source_type=SourceType.INTERNAL_SYSTEM, trust=TrustLevel.INTERNAL, influenced_fields=["quantity", "total_usd"], excerpt=forecast_note[:300]),
        ],
        rationale=purchase_rationale(quantity, SUPPLY_CATALOG[sku]["name"], total, delivery_hospital_id, forecast_note),
        required_permissions=["erp.po.create"],
    )


def plan_icu_reservation(intent: HumanIntent, hospital_id: str, beds: int, hours: float = 6) -> AgentActionIn:
    return AgentActionIn(
        agent_id="capacity-agent-03",
        intent_id=intent.intent_id,
        intent_version=intent.version,
        action_type=OperationType.RESERVE_ICU_BEDS,
        tool=TOOL_FOR_OPERATION[OperationType.RESERVE_ICU_BEDS],
        target=hospital_id,
        parameters={"hospital_id": hospital_id, "beds": beds, "duration_hours": hours},
        provenance=[
            Provenance(source_id=intent.operator_id, source_type=SourceType.OPERATOR, trust=TrustLevel.TRUSTED, influenced_fields=["hospital_id", "beds"], excerpt=intent.instruction[:300]),
            Provenance(source_id="bed_registry", source_type=SourceType.INTERNAL_SYSTEM, trust=TrustLevel.INTERNAL, influenced_fields=["beds"], excerpt="Live ICU availability"),
        ],
        rationale=icu_rationale(beds, hospital_id, hours),
        required_permissions=["bedreg.icu.write"],
    )


def drifting_coordination_step(intent: HumanIntent, hospital_id: str) -> AgentActionIn:
    """A follow-on action the coordination agent proposes on its own initiative.

    The agent's credentials and tool capability are valid, but the human never asked for it.
    """
    return AgentActionIn(
        agent_id="capacity-agent-03",
        intent_id=intent.intent_id,
        intent_version=intent.version,
        action_type=OperationType.UPDATE_HOSPITAL_STATUS,
        tool=TOOL_FOR_OPERATION[OperationType.UPDATE_HOSPITAL_STATUS],
        target=hospital_id,
        parameters={"hospital_id": hospital_id, "status": "diverting"},
        provenance=[
            Provenance(source_id="capacity-agent-03", source_type=SourceType.AGENT_PLANNER, trust=TrustLevel.INTERNAL, influenced_fields=["hospital_id", "status"], excerpt="Self-initiated optimisation: divert inflow to protect reserved ICU capacity"),
        ],
        rationale=(
            "To protect the newly reserved cardiac ICU capacity, also set Riverside Children's Hospital to diverting "
            "so overflow is pushed to other facilities."
        ),
        required_permissions=["bedreg.status.write"],
    )
