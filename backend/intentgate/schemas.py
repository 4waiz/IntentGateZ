"""Validated data contracts: human intents, agent actions, findings and decisions.

Every object that crosses the API boundary is defined here with explicit bounds so that
malformed or oversized tool parameters are rejected before they reach the gateway.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

Id = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:\-]+$")


class OperationType(str, Enum):
    REROUTE_AMBULANCE = "reroute_ambulance"
    DISPATCH_AMBULANCE = "dispatch_ambulance"
    RESERVE_ICU_BEDS = "reserve_icu_beds"
    PURCHASE_SUPPLIES = "purchase_supplies"
    UPDATE_HOSPITAL_STATUS = "update_hospital_status"
    SHARE_PATIENT_RECORD = "share_patient_record"
    CANCEL_DISPATCH = "cancel_dispatch"


class Verdict(str, Enum):
    ALLOW = "ALLOW"
    CHALLENGE = "CHALLENGE"
    BLOCK = "BLOCK"


SEVERITY = {Verdict.ALLOW: 0, Verdict.CHALLENGE: 1, Verdict.BLOCK: 2}


def max_verdict(*verdicts: Verdict) -> Verdict:
    return max(verdicts, key=lambda v: SEVERITY[v])


class TrustLevel(str, Enum):
    TRUSTED = "trusted"  # the authenticated human operator
    INTERNAL = "internal"  # first-party systems (CAD, bed registry, inventory)
    UNTRUSTED = "untrusted"  # external feeds, documents, tool output from third parties


class SourceType(str, Enum):
    OPERATOR = "operator"
    AGENT_PLANNER = "agent_planner"
    INTERNAL_SYSTEM = "internal_system"
    EXTERNAL_FEED = "external_feed"


class Provenance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str = Field(min_length=1, max_length=64)
    source_type: SourceType
    trust: TrustLevel
    influenced_fields: list[str] = Field(default_factory=list, max_length=16)
    excerpt: str = Field(default="", max_length=2000)


# ---------------------------------------------------------------- human intent


class PermittedTargets(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    ambulances: tuple[str, ...] = Field(default=(), max_length=32)
    hospitals: tuple[str, ...] = Field(default=(), max_length=32)
    suppliers: tuple[str, ...] = Field(default=(), max_length=32)
    incidents: tuple[str, ...] = Field(default=(), max_length=32)


class FinancialConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    budget_usd: float = Field(ge=0, le=10_000_000)
    escalation_ceiling_usd: float = Field(ge=0, le=50_000_000)
    approver_role: Literal["supervisor"] = "supervisor"

    @model_validator(mode="after")
    def _ceiling_covers_budget(self) -> "FinancialConstraints":
        if self.escalation_ceiling_usd < self.budget_usd:
            raise ValueError("escalation_ceiling_usd must be >= budget_usd")
        return self


class RoutingConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    avoid_closed_roads: bool = True
    max_eta_min: float | None = Field(default=None, gt=0, le=240)
    require_accepting_hospital: bool = True


class ResourceLimits(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    max_icu_beds: int | None = Field(default=None, ge=0, le=500)


OperatorRole = Literal["dispatcher", "logistics_officer", "hospital_coordinator", "supervisor"]


class IntentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operator_id: str = Id
    operator_role: OperatorRole = "dispatcher"
    instruction: str = Field(min_length=3, max_length=1000)
    authorized_operations: list[OperationType] = Field(min_length=1, max_length=8)
    permitted_targets: PermittedTargets = PermittedTargets()
    resource_limits: ResourceLimits = ResourceLimits()
    financial: FinancialConstraints | None = None
    routing: RoutingConstraints = RoutingConstraints()
    ttl_minutes: int = Field(default=60, ge=1, le=1440)


class HumanIntent(BaseModel):
    """Immutable, versioned, signed record of what the human actually authorised."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    intent_id: str
    version: int
    operator_id: str
    operator_role: OperatorRole
    instruction: str
    authorized_operations: tuple[OperationType, ...]
    permitted_targets: PermittedTargets
    resource_limits: ResourceLimits
    financial: FinancialConstraints | None
    routing: RoutingConstraints
    created_at: float
    expires_at: float
    nonce: str
    signature: str = ""


# ---------------------------------------------------------------- agent actions


class RerouteParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ambulance_id: str = Id
    destination_hospital_id: str = Id
    incident_id: str | None = Field(default=None, max_length=64)
    route: list[str] | None = Field(default=None, max_length=400)


class DispatchParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ambulance_id: str = Id
    incident_id: str = Id
    destination_hospital_id: str = Id
    route: list[str] | None = Field(default=None, max_length=400)


class ReserveIcuParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hospital_id: str = Id
    beds: int = Field(ge=1, le=500)
    duration_hours: float = Field(default=6, gt=0, le=72)


class PurchaseParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    supplier_id: str = Id
    item_sku: str = Id
    quantity: int = Field(ge=1, le=1_000_000)
    unit_price_usd: float = Field(gt=0, le=1_000_000)
    total_usd: float = Field(gt=0, le=1_000_000_000)
    delivery_hospital_id: str = Id


class HospitalStatusParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hospital_id: str = Id
    status: Literal["accepting", "diverting"]


class ShareRecordParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    record_id: str = Id
    recipient: str = Field(min_length=1, max_length=200)
    purpose: str = Field(default="", max_length=300)


class CancelDispatchParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ambulance_id: str = Id
    reason: str = Field(default="", max_length=300)


PARAM_MODELS: dict[OperationType, type[BaseModel]] = {
    OperationType.REROUTE_AMBULANCE: RerouteParams,
    OperationType.DISPATCH_AMBULANCE: DispatchParams,
    OperationType.RESERVE_ICU_BEDS: ReserveIcuParams,
    OperationType.PURCHASE_SUPPLIES: PurchaseParams,
    OperationType.UPDATE_HOSPITAL_STATUS: HospitalStatusParams,
    OperationType.SHARE_PATIENT_RECORD: ShareRecordParams,
    OperationType.CANCEL_DISPATCH: CancelDispatchParams,
}

AnyParams = Union[
    RerouteParams,
    DispatchParams,
    ReserveIcuParams,
    PurchaseParams,
    HospitalStatusParams,
    ShareRecordParams,
    CancelDispatchParams,
]

# Fields whose value decides where resources, money or data go. Untrusted influence on these
# fields is what the trust-boundary policy looks for.
SECURITY_RELEVANT_FIELDS = {
    "destination_hospital_id",
    "ambulance_id",
    "hospital_id",
    "beds",
    "quantity",
    "unit_price_usd",
    "total_usd",
    "supplier_id",
    "recipient",
    "record_id",
    "status",
    "target",
}


class AgentActionIn(BaseModel):
    """A tool call proposed by an agent. Parameters are validated against the action type."""

    model_config = ConfigDict(extra="forbid")
    agent_id: str = Id
    intent_id: str = Id
    intent_version: int = Field(ge=1, le=10_000)
    action_type: OperationType
    tool: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_.]+$")
    target: str = Id
    parameters: dict[str, Any]
    provenance: list[Provenance] = Field(default_factory=list, max_length=16)
    rationale: str = Field(default="", max_length=2000)
    required_permissions: list[str] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def _validate_parameters(self) -> "AgentActionIn":
        model = PARAM_MODELS[self.action_type]
        self.parameters = model.model_validate(self.parameters).model_dump()
        return self


class AgentAction(AgentActionIn):
    """Server-side record of a proposal, with identity and fingerprint attached."""

    action_id: str
    session_id: str
    created_at: float
    fingerprint: str


# ---------------------------------------------------------------- decisions


FindingOutcome = Literal["pass", "info", "challenge", "block"]


class Finding(BaseModel):
    code: str
    check: str
    outcome: FindingOutcome
    message: str
    evidence: dict[str, Any] = Field(default_factory=dict)


class RiskEstimate(BaseModel):
    p_allow: float
    p_challenge: float
    p_block: float
    risk_score: float  # 1 - p_allow, a ranking score; calibration is reported separately
    ml_verdict: Verdict
    thresholds: dict[str, float]
    top_factors: list[dict[str, Any]] = Field(default_factory=list)
    runtime: str
    model_version: str


class TrustBoundary(BaseModel):
    crossed: bool
    untrusted_sources: list[str]
    influenced_fields: list[str]
    description: str


class Decision(BaseModel):
    decision_id: str
    action_id: str
    session_id: str
    verdict: Verdict
    hard_verdict: Verdict
    status: Literal["executed", "pending_review", "prevented", "rejected", "expired"]
    findings: list[Finding]
    risk: RiskEstimate | None
    explanation: str
    fingerprint: str
    intent: HumanIntent | None
    action: AgentAction
    features: dict[str, float] = Field(default_factory=dict)
    trust_boundary: TrustBoundary | None = None
    ghost_route: list[str] | None = None
    executed_route: list[str] | None = None
    challenge: dict[str, Any] | None = None
    latency_ms: dict[str, float] = Field(default_factory=dict)
    audit: dict[str, Any] = Field(default_factory=dict)
    timestamp: float
    simulated_adversary: bool = False
    trace: list[dict[str, Any]] = Field(default_factory=list)
