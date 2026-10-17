"""FastAPI application exposing the IntentGate Z gateway, simulation and evidence endpoints.

Run:  uvicorn intentgate.api:app --host 127.0.0.1 --port 8000   (from backend/)
OpenAPI docs are served at /api/docs.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from . import __version__, platform_info, scenarios
from .agents import AGENTS
from .audit import AuditLog
from .config import settings
from .explainer import Explainer
from .gateway import Gateway, GatewayError
from .injection import InjectionDetector
from .metrics import Metrics
from .risk_model import RiskModel
from .schemas import AgentActionIn, IntentCreate
from .sessions import OPERATORS, SUPERVISOR, Session, SessionManager

audit = AuditLog(settings.db_path)
injection = InjectionDetector(settings.artifacts_dir)
risk = RiskModel(settings.artifacts_dir)
metrics = Metrics()
sessions = SessionManager(settings.signing_key, settings.max_sessions, settings.session_ttl_s)
gateway = Gateway(settings, audit, risk, injection, metrics, sessions)
explainer = Explainer(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    sessions.loop = asyncio.get_running_loop()
    audit.append("service.started", "system", "intentgate", {"version": __version__, "model": risk.info()["runtime"], "arch": platform_info.static_facts()["architecture"]})
    yield


app = FastAPI(
    title="IntentGate Z API",
    version=__version__,
    description="Real-time intent-security gateway for autonomous AI agents. Authorized doesn't always mean intended.",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-IG-Session", "X-IG-Supervisor", "X-IG-Operator"],
    max_age=600,
)

_buckets: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    fwd = request.headers.get("x-forwarded-for")
    if fwd and peer in ("127.0.0.1", "::1"):
        return fwd.split(",")[0].strip()
    return peer


@app.middleware("http")
async def guard(request: Request, call_next):
    metrics.http_requests += 1
    if request.method == "POST":
        length = int(request.headers.get("content-length") or 0)
        if length > settings.max_body_bytes:
            return JSONResponse({"error": "payload_too_large", "limit_bytes": settings.max_body_bytes}, status_code=413)
        ip = _client_ip(request)
        q = _buckets[ip]
        now = time.time()
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= settings.rate_limit_per_min:
            return JSONResponse({"error": "rate_limited", "retry_after_s": 60}, status_code=429)
        q.append(now)
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-IntentGate-Arch"] = platform_info.static_facts()["architecture"]
    return response


@app.exception_handler(GatewayError)
async def _gateway_error(_: Request, exc: GatewayError):
    return JSONResponse({"error": exc.code, "message": exc.message, "detail": exc.detail}, status_code=exc.status)


def session_dep(x_ig_session: str | None = Header(default=None)) -> Session:
    s = sessions.get(x_ig_session)
    if s is None:
        raise HTTPException(status_code=401, detail="unknown or expired session; POST /api/session first")
    return s


def operator_dep(x_ig_operator: str | None = Header(default=None)) -> None:
    if not settings.operator_token or not x_ig_operator or not hmac.compare_digest(x_ig_operator, settings.operator_token):
        raise HTTPException(status_code=403, detail="operator credential required")


def _dump(obj: Any) -> Any:
    return obj.model_dump(mode="json") if hasattr(obj, "model_dump") else obj


# ------------------------------------------------------------------ platform & health


@app.get("/api/health", tags=["platform"])
def health() -> dict[str, Any]:
    f = platform_info.static_facts()
    return {
        "status": "ok",
        "version": __version__,
        "uptime_s": round(time.time() - platform_info.STARTED_AT, 1),
        "model": {"available": risk.available, "runtime": risk.runtime, "version": risk.version, "accelerator": risk.accelerator},
        "platform": {"architecture": f["architecture"], "is_ibm_z": f["is_ibm_z"], "machine_model": f["machine_model"], "os": f["os"]},
        "server_time": time.time(),
    }


@app.get("/api/platform", tags=["platform"])
def platform() -> dict[str, Any]:
    return {
        **platform_info.facts(),
        "model": risk.info(),
        "injection_detector": {"runtime": injection.runtime, "version": injection.version},
        "explainer": explainer.info(),
        "audit": audit.head(),
        "evidence": _evidence_index(),
    }


def _evidence_index() -> list[dict[str, Any]]:
    root = settings.evidence_dir / "ibmz"
    if not root.is_dir():
        return []
    return [{"file": p.name, "bytes": p.stat().st_size} for p in sorted(root.iterdir()) if p.is_file()][:50]


@app.get("/api/metrics", tags=["platform"])
def get_metrics() -> dict[str, Any]:
    return {
        **metrics.snapshot(),
        "inference_count": risk.inference_count,
        "sessions_active": sessions.count(),
        "audit_records": audit.count(),
        "memory": platform_info.memory_mb(),
        "load_avg": platform_info.load_avg(),
    }


@app.get("/api/model/info", tags=["model"])
def model_info() -> dict[str, Any]:
    return {"risk_model": risk.info(), "injection_detector": {"runtime": injection.runtime, "version": injection.version}, "explainer": explainer.info()}


@app.get("/api/benchmark/results", tags=["model"])
def benchmark_results() -> dict[str, Any]:
    out: dict[str, Any] = {}
    root = settings.results_dir
    if root.is_dir():
        for p in sorted(root.glob("*.json")):
            try:
                out[p.stem] = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                out[p.stem] = {"error": "unreadable"}
    return out


@app.get("/api/benchmark/charts/{name}", tags=["model"])
def benchmark_chart(name: str) -> FileResponse:
    if not name.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(400, "bad name")
    p = settings.results_dir / "charts" / f"{name}.png"
    if not p.is_file():
        raise HTTPException(404, "chart not found")
    return FileResponse(p, media_type="image/png")


# ------------------------------------------------------------------ session & static data


@app.post("/api/session", tags=["session"])
def create_session() -> dict[str, Any]:
    s = sessions.create()
    audit.append("session.created", s.id, s.id, {"note": "sandbox created"})
    return {
        "session_id": s.id,
        "supervisor": {**SUPERVISOR, "credential": s.supervisor_token},
        "operators": OPERATORS,
        "server_time": time.time(),
        "note": "Each viewer gets an isolated sandbox. The demo supervisor credential is separate from operator and agent identities.",
    }


@app.get("/api/session", tags=["session"])
def get_session(s: Session = Depends(session_dep)) -> dict[str, Any]:
    return {"session_id": s.id, "created_at": s.created_at, "server_time": time.time()}


@app.get("/api/city", tags=["simulation"])
def city() -> dict[str, Any]:
    from .city import build_city

    return build_city().to_json()


@app.get("/api/agents", tags=["simulation"])
def agents() -> list[dict[str, Any]]:
    return [a.to_json() for a in AGENTS.values()]


@app.get("/api/scenarios", tags=["scenarios"])
def list_scenarios() -> list[dict[str, Any]]:
    return list(scenarios.SCENARIOS.values())


# ------------------------------------------------------------------ simulation


def _state(s: Session) -> dict[str, Any]:
    snap = s.world.snapshot()
    snap["intents"] = [_dump(i) for i in s.intents.all()]
    snap["challenges"] = list(s.challenges.values())
    return snap


@app.get("/api/simulation/state", tags=["simulation"])
def simulation_state(s: Session = Depends(session_dep)) -> dict[str, Any]:
    return _state(s)


class ConditionChange(BaseModel):
    kind: str = Field(pattern="^(close_road|reopen_road|hospital)$")
    edge_id: str | None = Field(default=None, max_length=64)
    hospital_id: str | None = Field(default=None, max_length=64)
    status: str | None = Field(default=None, pattern="^(accepting|diverting)$")
    beds_available: int | None = Field(default=None, ge=0, le=500)
    icu_available: int | None = Field(default=None, ge=0, le=200)
    reason: str = Field(default="", max_length=200)


@app.post("/api/simulation/conditions", tags=["simulation"])
def change_conditions(body: ConditionChange, s: Session = Depends(session_dep)) -> dict[str, Any]:
    """Change the sandbox environment (not an agent action): close roads, alter hospital capacity."""
    w = s.world
    if body.kind in ("close_road", "reopen_road"):
        if body.edge_id not in w.city.edges:
            raise HTTPException(404, "unknown road segment")
        (w.close_road(body.edge_id, body.reason or "Closed by scenario studio") if body.kind == "close_road" else w.reopen_road(body.edge_id))
    else:
        if body.hospital_id not in w.hospitals:
            raise HTTPException(404, "unknown hospital")
        w.set_hospital_condition(body.hospital_id, status=body.status, beds=body.beds_available, icu=body.icu_available, reason=body.reason)
    audit.append("environment.changed", s.id, body.edge_id or body.hospital_id or "-", body.model_dump())
    sessions.publish(s, {"type": "state", "state_version": w.version})
    return _state(s)


@app.post("/api/scenarios/reset", tags=["scenarios"])
def reset_sandbox(s: Session = Depends(session_dep)) -> dict[str, Any]:
    sessions.reset(s)
    audit.append("session.reset", s.id, s.id, {})
    sessions.publish(s, {"type": "state", "state_version": s.world.version})
    return _state(s)


@app.post("/api/scenarios/{scenario_id}/run", tags=["scenarios"])
def run_scenario(scenario_id: str, s: Session = Depends(session_dep)) -> dict[str, Any]:
    if scenario_id == "injection-safe-replan":
        try:
            res = scenarios.safe_replan(gateway, s)
        except KeyError as exc:
            raise HTTPException(409, str(exc))
        return {"scenario": {"id": "injection-safe-replan"}, "intent": _dump(res["intent"]), "decisions": [_dump(d) for d in res["decisions"]]}
    if scenario_id not in scenarios.SCENARIOS:
        raise HTTPException(404, "unknown scenario")
    res = scenarios.run(gateway, s, scenario_id)
    return {k: ([_dump(d) for d in v] if k == "decisions" else _dump(v)) for k, v in res.items()}


# ------------------------------------------------------------------ intents & actions


@app.get("/api/intents", tags=["intents"])
def list_intents(s: Session = Depends(session_dep)) -> list[dict[str, Any]]:
    return [_dump(i) for i in s.intents.all()]


@app.post("/api/intents", tags=["intents"])
def create_intent(body: IntentCreate, s: Session = Depends(session_dep)) -> dict[str, Any]:
    intent = s.intents.create(body)
    audit.append("intent.registered", s.id, intent.intent_id, {"version": intent.version, "operator": intent.operator_id, "operations": [o.value for o in intent.authorized_operations], "signature": intent.signature})
    return _dump(intent)


@app.post("/api/actions/evaluate", tags=["actions"])
def evaluate_action(body: AgentActionIn, s: Session = Depends(session_dep)) -> dict[str, Any]:
    return _dump(gateway.evaluate(s, body, origin="api"))


@app.get("/api/actions/{action_id}", tags=["actions"])
def get_action(action_id: str, s: Session = Depends(session_dep)) -> dict[str, Any]:
    dec_id = s.actions.get(action_id)
    if not dec_id or dec_id not in s.decisions:
        raise HTTPException(404, "unknown action")
    return _dump(s.decisions[dec_id])


class ExecuteBody(BaseModel):
    grant: str = Field(min_length=10, max_length=4000)


@app.post("/api/actions/{action_id}/execute", tags=["challenges"])
def execute_action(action_id: str, body: ExecuteBody, s: Session = Depends(session_dep)) -> dict[str, Any]:
    return gateway.execute_with_grant(s, action_id, body.grant)


@app.get("/api/decisions", tags=["actions"])
def list_decisions(limit: int = Query(50, ge=1, le=400), s: Session = Depends(session_dep)) -> list[dict[str, Any]]:
    out = []
    for d in list(s.decisions.values())[-limit:][::-1]:
        out.append(
            {
                "decision_id": d.decision_id,
                "action_id": d.action_id,
                "verdict": d.verdict.value,
                "status": d.status,
                "agent_id": d.action.agent_id,
                "action_type": d.action.action_type.value,
                "target": d.action.target,
                "risk_score": d.risk.risk_score if d.risk else None,
                "decision_ms": d.latency_ms.get("decision_ms"),
                "timestamp": d.timestamp,
                "simulated_adversary": d.simulated_adversary,
                "explanation": d.explanation,
            }
        )
    return out


@app.get("/api/decisions/{decision_id}", tags=["actions"])
def get_decision(decision_id: str, s: Session = Depends(session_dep)) -> dict[str, Any]:
    d = s.decisions.get(decision_id)
    if d is None:
        raise HTTPException(404, "unknown decision")
    return _dump(d)


@app.get("/api/decisions/{decision_id}/trace", tags=["actions"])
def trace_decision(decision_id: str, s: Session = Depends(session_dep)) -> dict[str, Any]:
    d = s.decisions.get(decision_id)
    if d is None:
        raise HTTPException(404, "unknown decision")
    records = [audit.get(v["seq"]) for v in d.audit.values() if isinstance(v, dict) and "seq" in v]
    related = [r for r in audit.list(s.id, limit=400) if r["subject_id"] in (d.action_id, decision_id, (d.challenge or {}).get("challenge_id"))]
    seen = {r["seq"] for r in records if r}
    records += [r for r in related if r["seq"] not in seen]
    records = sorted([r for r in records if r], key=lambda r: r["seq"])
    return {"decision_id": decision_id, "verdict": d.verdict.value, "status": d.status, "trace": d.trace, "audit_records": records, "latency_ms": d.latency_ms, "chain": audit.head()}


@app.post("/api/decisions/{decision_id}/explain", tags=["actions"])
def explain_decision(decision_id: str, s: Session = Depends(session_dep)) -> dict[str, Any]:
    d = s.decisions.get(decision_id)
    if d is None:
        raise HTTPException(404, "unknown decision")
    if not explainer.available:
        raise HTTPException(503, explainer.info().get("reason", "local language model not available"))
    res = explainer.explain(d)
    audit.append("decision.explained", s.id, decision_id, {"model": res.get("model"), "tokens": res.get("tokens"), "latency_ms": res.get("latency_ms")})
    return res


# ------------------------------------------------------------------ challenges


class ApproveBody(BaseModel):
    approver_id: str = Field(min_length=1, max_length=64)
    approver_role: str = Field(min_length=1, max_length=32)
    reviewed_fingerprint: str = Field(min_length=64, max_length=64)
    justification: str = Field(default="", max_length=500)


class RejectBody(BaseModel):
    approver_id: str = Field(min_length=1, max_length=64)
    reason: str = Field(default="", max_length=500)


@app.get("/api/challenges", tags=["challenges"])
def list_challenges(s: Session = Depends(session_dep)) -> list[dict[str, Any]]:
    return list(s.challenges.values())


@app.post("/api/challenges/{challenge_id}/approve", tags=["challenges"])
def approve(challenge_id: str, body: ApproveBody, s: Session = Depends(session_dep), x_ig_supervisor: str | None = Header(default=None)) -> dict[str, Any]:
    return gateway.approve(s, challenge_id, body.approver_id, body.approver_role, body.reviewed_fingerprint, body.justification, x_ig_supervisor or "")


@app.post("/api/challenges/{challenge_id}/reject", tags=["challenges"])
def reject(challenge_id: str, body: RejectBody, s: Session = Depends(session_dep), x_ig_supervisor: str | None = Header(default=None)) -> dict[str, Any]:
    return gateway.reject(s, challenge_id, body.approver_id, body.reason, x_ig_supervisor or "")


# ------------------------------------------------------------------ audit


@app.get("/api/audit", tags=["audit"])
def audit_list(limit: int = Query(60, ge=1, le=1000), scope: str = Query("session", pattern="^(session|all)$"), x_ig_session: str | None = Header(default=None)) -> list[dict[str, Any]]:
    sid = None
    if scope == "session":
        s = sessions.get(x_ig_session)
        if s is None:
            raise HTTPException(401, "unknown session")
        sid = s.id
    return audit.list(sid, limit=limit)


@app.get("/api/audit/verify", tags=["audit"])
def audit_verify() -> dict[str, Any]:
    return audit.verify()


@app.get("/api/audit/export", tags=["audit"])
def audit_export(x_ig_session: str | None = Header(default=None), session: str | None = Query(default=None)) -> Response:
    s = sessions.get(x_ig_session or session)
    records = list(reversed(audit.list(s.id if s else None, limit=1000)))
    body = json.dumps({"exported_at": time.time(), "chain_head": audit.head(), "verification": audit.verify(), "records": records}, indent=2)
    return Response(body, media_type="application/json", headers={"Content-Disposition": "attachment; filename=intentgate-audit.json"})


# ------------------------------------------------------------------ live events


@app.get("/api/events/stream", tags=["events"])
async def events(request: Request, session: str = Query(..., max_length=64)) -> StreamingResponse:
    s = sessions.get(session)
    if s is None:
        raise HTTPException(401, "unknown session")
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    s.subscribers.add(q)

    async def gen():
        try:
            yield f"data: {json.dumps({'type': 'hello', 'state_version': s.world.version, 'server_time': time.time()})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'ping', 'server_time': time.time()})}\n\n"
        finally:
            s.subscribers.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ operator-only


@app.post("/api/admin/reset-all", tags=["operator"], dependencies=[Depends(operator_dep)])
def admin_reset_all() -> dict[str, Any]:
    n = 0
    for s in sessions.all():
        sessions.reset(s)
        n += 1
    audit.append("admin.reset_all", "system", "operator", {"sessions": n})
    return {"reset_sessions": n}


# ------------------------------------------------------------------ static frontend (optional)

if settings.static_dir and Path(settings.static_dir).is_dir():
    static_root = Path(settings.static_dir).resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        target = (static_root / path).resolve()
        if path and target.is_file() and static_root in target.parents:
            return FileResponse(target)
        return FileResponse(static_root / "index.html")
