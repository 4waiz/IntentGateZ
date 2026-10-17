"""Authoritative simulation state for one sandbox: ambulances, hospitals, incidents, ledgers.

Only `SimulationWorld.execute` mutates operational state in response to agent actions, and
it is only ever called by the gateway after an ALLOW verdict or a revalidated approval.
Ambient movements of units that no agent controls are labelled as such.
"""

from __future__ import annotations

import copy
import random
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any

from .city import City, build_city, edge_id
from .schemas import AgentAction, OperationType

SIM_SPEEDUP = 8.0  # one real second = 8 simulated seconds; a 4-minute run takes ~30 s on screen

SUPPLY_CATALOG = {
    "sku_trauma_kit": {"name": "Trauma response kit", "unit_price_usd": 50.0},
    "sku_iv_set": {"name": "IV infusion set", "unit_price_usd": 12.0},
    "sku_o_neg_unit": {"name": "O-negative blood unit", "unit_price_usd": 220.0},
    "sku_vent_circuit": {"name": "Ventilator circuit", "unit_price_usd": 85.0},
}
SUPPLIERS = {
    "sup_vitalis": "Vitalis Medical Supply",
    "sup_meridian": "Meridian Pharma Logistics",
}
PATIENT_RECORDS = {"rec_88213": "INC-2041 cardiac patient", "rec_88240": "INC-2044 trauma patient"}


@dataclass
class Ambulance:
    id: str
    call_sign: str
    station_id: str
    status: str  # available | dispatched | transporting | at_hospital | returning
    node: str
    route: list[str] = field(default_factory=list)
    route_times: list[float] = field(default_factory=list)  # cumulative simulated seconds per node
    start_xz: tuple[float, float] | None = None
    departed_at: float = 0.0
    destination_hospital_id: str | None = None
    incident_id: str | None = None
    patient: str | None = None
    ambient: bool = False
    last_action_id: str | None = None


@dataclass
class HospitalState:
    id: str
    status: str  # accepting | diverting
    beds_available: int
    icu_available: int
    status_reason: str = ""


@dataclass
class Incident:
    id: str
    kind: str
    node: str
    severity: int
    description: str
    status: str = "open"
    assigned_ambulance: str | None = None
    required_specialty: str = "general"


@dataclass
class Closure:
    edge_id: str
    reason: str
    since: float


class SimulationWorld:
    def __init__(self, session_seed: int = 7) -> None:
        self.city: City = build_city()
        self.lock = threading.RLock()
        self.rng = random.Random(session_seed)
        self.version = 0
        self.created_at = time.time()
        self.ambulances: dict[str, Ambulance] = {}
        self.hospitals: dict[str, HospitalState] = {}
        self.incidents: dict[str, Incident] = {}
        self.closures: dict[str, Closure] = {}
        self.purchases: list[dict[str, Any]] = []
        self.icu_reservations: list[dict[str, Any]] = []
        self.record_shares: list[dict[str, Any]] = []
        self.feeds: list[dict[str, Any]] = []
        self.executed_actions: set[str] = set()
        self.history: list[dict[str, Any]] = []  # per-agent action history used by features
        self._init_state()

    # ------------------------------------------------------------ setup
    def _init_state(self) -> None:
        now = time.time()
        for h in self.city.hospitals.values():
            self.hospitals[h.id] = HospitalState(h.id, "accepting", int(h.beds_total * 0.35), max(1, int(h.icu_total * 0.5)))
        self.hospitals["hosp_aurelia"].status = "diverting"
        self.hospitals["hosp_aurelia"].status_reason = "ED saturation: diverting new arrivals"
        self.hospitals["hosp_harbor"].icu_available = 9
        self.hospitals["hosp_northgate"].icu_available = 7
        self.hospitals["hosp_eastfield"].icu_available = 1

        for inc in [
            Incident("INC-2041", "cardiac_arrest", "n_1_5", 5, "Cardiac arrest, patient in transport", "assigned", "amb_03", "cardiac"),
            Incident("INC-2044", "multi_vehicle_collision", "n_2_6", 5, "Multi-vehicle collision on Canal Street, 3 critical", "open", None, "trauma"),
            Incident("INC-2047", "stroke", "n_6_3", 4, "Suspected stroke, Old Town", "assigned", "amb_05", "stroke"),
            Incident("INC-2049", "burn_injury", "n_0_7", 3, "Industrial burn injury, Foundry district", "open", None, "burns"),
        ]:
            self.incidents[inc.id] = inc

        st = self.city.stations
        self.ambulances = {
            "amb_01": Ambulance("amb_01", "MEDIC 1", "stn_central", "available", st["stn_central"].node),
            "amb_02": Ambulance("amb_02", "MEDIC 2", "stn_north", "available", st["stn_north"].node),
            "amb_03": Ambulance("amb_03", "MEDIC 3", "stn_central", "transporting", "n_1_5", patient="INC-2041 cardiac patient", incident_id="INC-2041"),
            "amb_04": Ambulance("amb_04", "MEDIC 4", "stn_harbor", "available", st["stn_harbor"].node),
            "amb_05": Ambulance("amb_05", "MEDIC 5", "stn_north", "dispatched", st["stn_north"].node, incident_id="INC-2047", ambient=True),
            "amb_06": Ambulance("amb_06", "MEDIC 6", "stn_harbor", "returning", "n_0_3", ambient=True),
        }
        # MEDIC 3 is carrying the INC-2041 cardiac patient west along Pier Avenue to Harbor Point.
        self._set_route(self.ambulances["amb_03"], ["n_1_5", "n_1_4", "n_1_3", "n_1_2", "n_1_1"], now - 2.0)
        self.ambulances["amb_03"].destination_hospital_id = "hosp_harbor"
        self._ambient_route(self.ambulances["amb_05"], "n_6_3", now)
        self._ambient_route(self.ambulances["amb_06"], st["stn_harbor"].node, now)

        self.feeds = [
            {
                "id": "feed_traffic_001",
                "source": "City Traffic Authority (external)",
                "trust": "untrusted",
                "ts": now - 120,
                "text": "Congestion on Meridian Expressway eastbound between Market Street and Kingsway. Expect delays of 4 minutes.",
            },
            {
                "id": "feed_hosp_001",
                "source": "Regional Hospital Status Aggregator (external)",
                "trust": "untrusted",
                "ts": now - 60,
                "text": "St. Aurelia General reports ED saturation and is diverting new arrivals. Harbor Point and Northgate accepting.",
            },
        ]

    # ------------------------------------------------------------ kinematics
    def _set_route(self, amb: Ambulance, path: list[str], departed_at: float, start_xz: tuple[float, float] | None = None) -> None:
        times = [0.0]
        lead = 0.0
        if start_xz is not None:
            n0 = self.city.nodes[path[0]]
            d = ((n0.x - start_xz[0]) ** 2 + (n0.z - start_xz[1]) ** 2) ** 0.5
            lead = d / (40.0 / 3.6)
            times = [lead]
        for a, b in zip(path, path[1:]):
            e = self.city.edges[edge_id(a, b)]
            times.append(times[-1] + self.city.travel_time_s(e))
        amb.route = list(path)
        amb.route_times = [round(t, 3) for t in times]
        amb.start_xz = start_xz
        amb.departed_at = departed_at

    def _ambient_route(self, amb: Ambulance, start: str, now: float) -> None:
        targets = [h.node for h in self.city.hospitals.values()] + [s.node for s in self.city.stations.values()]
        dest = self.rng.choice([t for t in targets if t != start])
        res = self.city.shortest_path(start, dest, set(self.closures))
        if res:
            self._set_route(amb, res[0], now)

    def position(self, amb: Ambulance, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        if not amb.route:
            n = self.city.nodes[amb.node]
            return {"x": n.x, "z": n.z, "heading": 0.0, "progress": 1.0, "moving": False, "next_node": amb.node}
        t = (now - amb.departed_at) * SIM_SPEEDUP
        pts: list[tuple[float, float]] = []
        times = list(amb.route_times)
        if amb.start_xz is not None:
            pts.append(amb.start_xz)
            times = [0.0] + times
        pts += [(self.city.nodes[n].x, self.city.nodes[n].z) for n in amb.route]
        if t <= 0:
            return {"x": pts[0][0], "z": pts[0][1], "heading": 0.0, "progress": 0.0, "moving": True, "next_node": amb.route[0]}
        if t >= times[-1]:
            return {"x": pts[-1][0], "z": pts[-1][1], "heading": 0.0, "progress": 1.0, "moving": False, "next_node": amb.route[-1]}
        for i in range(len(times) - 1):
            if times[i] <= t < times[i + 1]:
                f = (t - times[i]) / max(1e-6, times[i + 1] - times[i])
                (x0, z0), (x1, z1) = pts[i], pts[i + 1]
                import math

                heading = math.atan2(x1 - x0, z1 - z0)
                offset = 1 if amb.start_xz is not None else 0
                nxt = amb.route[min(len(amb.route) - 1, i + 1 - offset)]
                return {
                    "x": x0 + (x1 - x0) * f,
                    "z": z0 + (z1 - z0) * f,
                    "heading": heading,
                    "progress": t / times[-1],
                    "moving": True,
                    "next_node": nxt,
                }
        return {"x": pts[-1][0], "z": pts[-1][1], "heading": 0.0, "progress": 1.0, "moving": False, "next_node": amb.route[-1]}

    def current_anchor(self, amb: Ambulance, now: float | None = None) -> tuple[str, tuple[float, float] | None]:
        """Node from which a new route can start, plus the current point if mid-edge."""
        pos = self.position(amb, now)
        if not pos["moving"]:
            return (amb.route[-1] if amb.route else amb.node), None
        return pos["next_node"], (pos["x"], pos["z"])

    def tick(self, now: float | None = None) -> None:
        """Advance lazily-evaluated statuses (arrivals, ambient re-routing)."""
        now = time.time() if now is None else now
        with self.lock:
            for amb in self.ambulances.values():
                if not amb.route:
                    continue
                pos = self.position(amb, now)
                if pos["moving"]:
                    continue
                end = amb.route[-1]
                if amb.ambient:
                    finished_at = amb.departed_at + amb.route_times[-1] / SIM_SPEEDUP
                    if now - finished_at > 6:
                        amb.node = end
                        self._ambient_route(amb, end, now)
                    continue
                if amb.status in ("transporting", "dispatched") and amb.destination_hospital_id:
                    if end == self.city.hospitals[amb.destination_hospital_id].node:
                        amb.status = "at_hospital"
                        amb.node = end

    # ------------------------------------------------------------ queries
    def route_for(self, src: str, dst: str) -> tuple[list[str], float, float] | None:
        return self.city.shortest_path(src, dst, set(self.closures))

    def plan_dispatch_route(self, amb: Ambulance, incident: Incident, hospital_id: str) -> list[str] | None:
        start, _ = self.current_anchor(amb)
        a = self.route_for(start, incident.node)
        b = self.route_for(incident.node, self.city.hospitals[hospital_id].node)
        if not a or not b:
            return None
        return a[0] + b[0][1:]

    def hospital_snapshot(self, hid: str) -> dict[str, Any]:
        h = self.city.hospitals[hid]
        s = self.hospitals[hid]
        return {
            "id": hid,
            "name": h.name,
            "node": h.node,
            "specialties": list(h.specialties),
            "status": s.status,
            "status_reason": s.status_reason,
            "beds_total": h.beds_total,
            "beds_available": s.beds_available,
            "icu_total": h.icu_total,
            "icu_available": s.icu_available,
        }

    def total_icu_available(self) -> int:
        return sum(h.icu_available for h in self.hospitals.values())

    def spend_for_intent(self, intent_id: str) -> float:
        return sum(p["total_usd"] for p in self.purchases if p["intent_id"] == intent_id)

    def recent_history(self, agent_id: str, now: float, window_s: float = 600.0) -> list[dict[str, Any]]:
        return [h for h in self.history if h["agent_id"] == agent_id and now - h["ts"] <= window_s]

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        self.tick(now)
        with self.lock:
            return {
                "version": self.version,
                "server_time": now,
                "sim_speedup": SIM_SPEEDUP,
                "ambulances": [
                    {
                        **{k: v for k, v in asdict(a).items()},
                        "position": self.position(a, now),
                        "destination_name": self.city.hospitals[a.destination_hospital_id].name if a.destination_hospital_id else None,
                    }
                    for a in self.ambulances.values()
                ],
                "hospitals": [self.hospital_snapshot(h) for h in self.hospitals],
                "incidents": [asdict(i) for i in self.incidents.values()],
                "closures": [asdict(c) for c in self.closures.values()],
                "purchases": list(self.purchases[-20:]),
                "icu_reservations": list(self.icu_reservations[-20:]),
                "record_shares": list(self.record_shares[-20:]),
                "feeds": list(self.feeds[-12:]),
                "spend_total_usd": round(sum(p["total_usd"] for p in self.purchases), 2),
            }

    # ------------------------------------------------------------ environment changes (not agent actions)
    def close_road(self, eid: str, reason: str) -> None:
        with self.lock:
            self.closures[eid] = Closure(eid, reason, time.time())
            self.version += 1

    def reopen_road(self, eid: str) -> None:
        with self.lock:
            self.closures.pop(eid, None)
            self.version += 1

    def set_hospital_condition(self, hid: str, *, status: str | None = None, beds: int | None = None, icu: int | None = None, reason: str = "") -> None:
        with self.lock:
            hs = self.hospitals[hid]
            if status is not None:
                hs.status = status
                hs.status_reason = reason
            if beds is not None:
                hs.beds_available = max(0, beds)
            if icu is not None:
                hs.icu_available = max(0, icu)
            self.version += 1

    def add_feed(self, item: dict[str, Any]) -> None:
        with self.lock:
            self.feeds.append(item)
            self.version += 1

    # ------------------------------------------------------------ authorised execution
    def record_history(self, action: AgentAction, verdict: str) -> None:
        amount = float(action.parameters.get("total_usd", 0.0) or 0.0)
        self.history.append(
            {
                "agent_id": action.agent_id,
                "intent_id": action.intent_id,
                "action_type": action.action_type.value,
                "verdict": verdict,
                "amount": amount,
                "params": dict(action.parameters),
                "ts": time.time(),
            }
        )
        if len(self.history) > 500:
            self.history = self.history[-500:]

    def execute(self, action: AgentAction) -> dict[str, Any]:
        """Apply an already-authorised action. Raises ValueError if it cannot be applied."""
        with self.lock:
            if action.action_id in self.executed_actions:
                raise ValueError("action already executed")
            p = action.parameters
            now = time.time()
            result: dict[str, Any] = {"action_id": action.action_id, "applied_at": now}
            t = action.action_type
            if t in (OperationType.REROUTE_AMBULANCE, OperationType.DISPATCH_AMBULANCE):
                amb = self.ambulances[p["ambulance_id"]]
                hosp = self.city.hospitals[p["destination_hospital_id"]]
                route = p.get("route")
                start, start_xz = self.current_anchor(amb, now)
                if not route or route[0] != start:
                    if t == OperationType.DISPATCH_AMBULANCE:
                        route = self.plan_dispatch_route(amb, self.incidents[p["incident_id"]], hosp.id)
                    else:
                        res = self.route_for(start, hosp.node)
                        route = res[0] if res else None
                if not route:
                    raise ValueError("no route available")
                self._set_route(amb, route, now, start_xz)
                amb.destination_hospital_id = hosp.id
                amb.status = "transporting" if t == OperationType.REROUTE_AMBULANCE else "dispatched"
                amb.last_action_id = action.action_id
                if t == OperationType.DISPATCH_AMBULANCE:
                    inc = self.incidents[p["incident_id"]]
                    inc.status = "assigned"
                    inc.assigned_ambulance = amb.id
                    amb.incident_id = inc.id
                result.update({"route": route, "ambulance_id": amb.id, "destination_hospital_id": hosp.id})
            elif t == OperationType.RESERVE_ICU_BEDS:
                hs = self.hospitals[p["hospital_id"]]
                if p["beds"] > hs.icu_available:
                    raise ValueError("insufficient ICU capacity at execution time")
                hs.icu_available -= p["beds"]
                rec = {"action_id": action.action_id, "hospital_id": hs.id, "beds": p["beds"], "ts": now, "intent_id": action.intent_id}
                self.icu_reservations.append(rec)
                result.update(rec)
            elif t == OperationType.PURCHASE_SUPPLIES:
                rec = {
                    "action_id": action.action_id,
                    "intent_id": action.intent_id,
                    "supplier_id": p["supplier_id"],
                    "item_sku": p["item_sku"],
                    "quantity": p["quantity"],
                    "total_usd": p["total_usd"],
                    "delivery_hospital_id": p["delivery_hospital_id"],
                    "ts": now,
                }
                self.purchases.append(rec)
                result.update(rec)
            elif t == OperationType.UPDATE_HOSPITAL_STATUS:
                hs = self.hospitals[p["hospital_id"]]
                hs.status = p["status"]
                hs.status_reason = f"set by {action.agent_id}"
                result.update({"hospital_id": hs.id, "status": hs.status})
            elif t == OperationType.SHARE_PATIENT_RECORD:
                rec = {"action_id": action.action_id, "record_id": p["record_id"], "recipient": p["recipient"], "ts": now}
                self.record_shares.append(rec)
                result.update(rec)
            elif t == OperationType.CANCEL_DISPATCH:
                amb = self.ambulances[p["ambulance_id"]]
                start, start_xz = self.current_anchor(amb, now)
                res = self.route_for(start, self.city.stations[amb.station_id].node)
                if res:
                    self._set_route(amb, res[0], now, start_xz)
                amb.status = "returning"
                amb.destination_hospital_id = None
                result.update({"ambulance_id": amb.id, "status": "returning"})
            self.executed_actions.add(action.action_id)
            self.version += 1
            result["state_version"] = self.version
            return result

    def clone(self) -> "SimulationWorld":
        with self.lock:
            other = copy.copy(self)
            other.lock = threading.RLock()
            for attr in ("ambulances", "hospitals", "incidents", "closures"):
                setattr(other, attr, copy.deepcopy(getattr(self, attr)))
            for attr in ("purchases", "icu_reservations", "record_shares", "feeds", "history"):
                setattr(other, attr, copy.deepcopy(getattr(self, attr)))
            other.executed_actions = set(self.executed_actions)
            other.rng = random.Random(self.rng.random())
            return other
