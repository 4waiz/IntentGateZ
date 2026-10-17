"""Deterministic synthetic city ("Nova Meridian") and road-network routing.

The city is fictional. It is generated from a fixed seed so that the backend, the dataset
generator and the 3D frontend all see the same intersections, roads and facilities.
Distances are metres; speeds are km/h.
"""

from __future__ import annotations

import heapq
import random
from dataclasses import dataclass, field
from functools import lru_cache

ROWS = 8
COLS = 10
SPACING_M = 400.0
CITY_SEED = 20261017

# Road classes: (speed km/h, lane width hint for the renderer)
ROAD_CLASSES = {"expressway": 80.0, "arterial": 50.0, "local": 32.0}
EXPRESSWAY_ROWS = {3}
EXPRESSWAY_COLS = {6}
ARTERIAL_ROWS = {0, 5, 7}
ARTERIAL_COLS = {0, 2, 9}

DISTRICTS = ["harbor", "old_town", "financial", "medical", "residential", "industrial", "university"]


def node_id(r: int, c: int) -> str:
    return f"n_{r}_{c}"


def edge_id(a: str, b: str) -> str:
    x, y = sorted((a, b))
    return f"{x}__{y}"


@dataclass(frozen=True)
class Node:
    id: str
    r: int
    c: int
    x: float
    z: float
    street: str


@dataclass(frozen=True)
class Edge:
    id: str
    a: str
    b: str
    length_m: float
    road_class: str
    speed_kmh: float
    name: str


@dataclass(frozen=True)
class Hospital:
    id: str
    name: str
    node: str
    specialties: tuple[str, ...]
    beds_total: int
    icu_total: int
    district: str


@dataclass(frozen=True)
class Station:
    id: str
    name: str
    node: str


@dataclass(frozen=True)
class Block:
    id: str
    r: int
    c: int
    x: float
    z: float
    district: str
    height_bias: float
    reserved_for: str | None


@dataclass
class City:
    nodes: dict[str, Node]
    edges: dict[str, Edge]
    adjacency: dict[str, list[tuple[str, str]]]  # node -> [(neighbour, edge_id)]
    hospitals: dict[str, Hospital]
    stations: dict[str, Station]
    blocks: list[Block]
    street_names: dict[str, str] = field(default_factory=dict)

    # ------------------------------------------------------------ routing
    def travel_time_s(self, edge: Edge, emergency: bool = True) -> float:
        speed = edge.speed_kmh * (1.25 if emergency else 1.0)
        return edge.length_m / (speed / 3.6)

    def shortest_path(
        self, src: str, dst: str, closed: frozenset[str] | set[str] = frozenset(), emergency: bool = True
    ) -> tuple[list[str], float, float] | None:
        """Dijkstra on travel time. Returns (node path, distance m, time s) or None."""
        if src not in self.nodes or dst not in self.nodes:
            return None
        if src == dst:
            return [src], 0.0, 0.0
        best: dict[str, float] = {src: 0.0}
        prev: dict[str, tuple[str, str]] = {}
        heap: list[tuple[float, str]] = [(0.0, src)]
        while heap:
            t, u = heapq.heappop(heap)
            if u == dst:
                break
            if t > best.get(u, float("inf")):
                continue
            for v, eid in self.adjacency[u]:
                if eid in closed:
                    continue
                nt = t + self.travel_time_s(self.edges[eid], emergency)
                if nt < best.get(v, float("inf")):
                    best[v] = nt
                    prev[v] = (u, eid)
                    heapq.heappush(heap, (nt, v))
        if dst not in best:
            return None
        path = [dst]
        dist = 0.0
        while path[-1] != src:
            u, eid = prev[path[-1]]
            dist += self.edges[eid].length_m
            path.append(u)
        path.reverse()
        return path, dist, best[dst]

    def route_edges(self, path: list[str]) -> list[str] | None:
        """Edge ids along a node path, or None when two consecutive nodes are not adjacent."""
        out = []
        for a, b in zip(path, path[1:]):
            eid = edge_id(a, b)
            if eid not in self.edges:
                return None
            out.append(eid)
        return out

    def route_metrics(self, path: list[str], closed: set[str] | frozenset[str] = frozenset()) -> dict:
        edges = self.route_edges(path)
        if edges is None:
            return {"valid": False, "reason": "route contains non-adjacent nodes"}
        dist = sum(self.edges[e].length_m for e in edges)
        t = sum(self.travel_time_s(self.edges[e]) for e in edges)
        closed_hits = [e for e in edges if e in closed]
        return {
            "valid": True,
            "distance_m": round(dist, 1),
            "eta_min": round(t / 60.0, 2),
            "closed_edges": closed_hits,
            "edges": edges,
        }

    def to_json(self) -> dict:
        return {
            "name": "Nova Meridian (fictional)",
            "rows": ROWS,
            "cols": COLS,
            "spacing_m": SPACING_M,
            "nodes": [n.__dict__ for n in self.nodes.values()],
            "edges": [e.__dict__ for e in self.edges.values()],
            "hospitals": [
                {**h.__dict__, "specialties": list(h.specialties)} for h in self.hospitals.values()
            ],
            "stations": [s.__dict__ for s in self.stations.values()],
            "blocks": [b.__dict__ for b in self.blocks],
        }


STREETS_EW = ["Harbor Way", "Pier Avenue", "Canal Street", "Meridian Expressway", "Old Mill Road", "Union Boulevard", "Elm Street", "North Ring Road"]
STREETS_NS = ["Bayfront Drive", "Cedar Lane", "Market Street", "Foundry Road", "Kingsway", "Lantern Street", "Skyline Expressway", "Orchard Avenue", "Quarry Lane", "Summit Boulevard"]


def _district_for(r: int, c: int) -> str:
    if c <= 1:
        return "harbor"
    if r >= 6 and c >= 6:
        return "university"
    if r <= 1 and c >= 6:
        return "industrial"
    if 2 <= r <= 4 and 3 <= c <= 5:
        return "financial"
    if 2 <= r <= 4 and c >= 7:
        return "medical"
    if r >= 5 and c <= 4:
        return "old_town"
    return "residential"


@lru_cache(maxsize=1)
def build_city() -> City:
    rng = random.Random(CITY_SEED)
    nodes: dict[str, Node] = {}
    for r in range(ROWS):
        for c in range(COLS):
            nid = node_id(r, c)
            nodes[nid] = Node(nid, r, c, c * SPACING_M, r * SPACING_M, f"{STREETS_EW[r]} & {STREETS_NS[c]}")

    edges: dict[str, Edge] = {}

    def add(a: str, b: str, cls: str, name: str) -> None:
        na, nb = nodes[a], nodes[b]
        length = ((na.x - nb.x) ** 2 + (na.z - nb.z) ** 2) ** 0.5
        # Small deterministic perturbation so equal-length routes have a stable winner.
        length *= 1.0 + rng.uniform(0.0, 0.06)
        eid = edge_id(a, b)
        edges[eid] = Edge(eid, a, b, round(length, 1), cls, ROAD_CLASSES[cls], name)

    for r in range(ROWS):
        for c in range(COLS - 1):
            cls = "expressway" if r in EXPRESSWAY_ROWS else "arterial" if r in ARTERIAL_ROWS else "local"
            add(node_id(r, c), node_id(r, c + 1), cls, STREETS_EW[r])
    for c in range(COLS):
        for r in range(ROWS - 1):
            cls = "expressway" if c in EXPRESSWAY_COLS else "arterial" if c in ARTERIAL_COLS else "local"
            add(node_id(r, c), node_id(r + 1, c), cls, STREETS_NS[c])

    # Remove a few local street segments to make the grid irregular, keeping connectivity.
    locals_ = sorted((e for e in edges.values() if e.road_class == "local"), key=lambda e: e.id)
    rng.shuffle(locals_)
    removed = 0
    protected = {
        # keep the scenario corridors intact
        edge_id(node_id(1, 2), node_id(1, 3)),
        edge_id(node_id(2, 3), node_id(2, 4)),
    }
    for e in locals_:
        if removed >= 9:
            break
        if e.id in protected:
            continue
        trial = {k: v for k, v in edges.items() if k != e.id}
        if _connected(nodes, trial):
            edges = trial
            removed += 1

    adjacency: dict[str, list[tuple[str, str]]] = {n: [] for n in nodes}
    for e in edges.values():
        adjacency[e.a].append((e.b, e.id))
        adjacency[e.b].append((e.a, e.id))
    for n in adjacency:
        adjacency[n].sort()

    hospitals = {
        h.id: h
        for h in [
            Hospital("hosp_aurelia", "St. Aurelia General", node_id(2, 4), ("general", "cardiac", "stroke"), 48, 12, "financial"),
            Hospital("hosp_harbor", "Harbor Point Medical Center", node_id(1, 1), ("cardiac", "stroke", "general"), 64, 18, "harbor"),
            Hospital("hosp_northgate", "Northgate Trauma Center", node_id(6, 7), ("trauma", "burns", "general"), 40, 14, "university"),
            Hospital("hosp_riverside", "Riverside Children's Hospital", node_id(6, 2), ("pediatric", "general"), 28, 6, "old_town"),
            Hospital("hosp_eastfield", "Eastfield Community Hospital", node_id(2, 8), ("general",), 22, 4, "medical"),
        ]
    }
    stations = {
        s.id: s
        for s in [
            Station("stn_central", "Central EMS Station", node_id(4, 4)),
            Station("stn_harbor", "Harbor EMS Station", node_id(4, 0)),
            Station("stn_north", "North Ring EMS Station", node_id(7, 5)),
        ]
    }

    reserved = {h.node: h.id for h in hospitals.values()} | {s.node: s.id for s in stations.values()}
    blocks = []
    for r in range(ROWS - 1):
        for c in range(COLS - 1):
            bx = (c + 0.5) * SPACING_M
            bz = (r + 0.5) * SPACING_M
            district = _district_for(r, c)
            bias = {"financial": 2.6, "medical": 1.5, "harbor": 1.1, "industrial": 0.7, "university": 1.2, "old_town": 0.8}.get(district, 1.0)
            # A block is reserved when one of its corners hosts a facility at its north-west corner.
            res = reserved.get(node_id(r, c))
            blocks.append(Block(f"b_{r}_{c}", r, c, bx, bz, district, round(bias * rng.uniform(0.8, 1.25), 3), res))

    return City(nodes, edges, adjacency, hospitals, stations, blocks)


def _connected(nodes: dict[str, Node], edges: dict[str, Edge]) -> bool:
    adj: dict[str, list[str]] = {n: [] for n in nodes}
    for e in edges.values():
        adj[e.a].append(e.b)
        adj[e.b].append(e.a)
    start = next(iter(nodes))
    seen = {start}
    stack = [start]
    while stack:
        u = stack.pop()
        for v in adj[u]:
            if v not in seen:
                seen.add(v)
                stack.append(v)
    return len(seen) == len(nodes)
