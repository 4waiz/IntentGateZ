/**
 * TypeScript contracts for the IntentGate Z backend.
 * Derived from backend/intentgate/schemas.py and the recorded samples in docs/api-samples/*.json.
 * The frontend never computes verdicts; these types only describe what the gateway returns.
 */

export type Verdict = "ALLOW" | "CHALLENGE" | "BLOCK";

export type OperationType =
  | "reroute_ambulance"
  | "dispatch_ambulance"
  | "reserve_icu_beds"
  | "purchase_supplies"
  | "update_hospital_status"
  | "share_patient_record"
  | "cancel_dispatch";

export type DecisionStatus = "executed" | "pending_review" | "prevented" | "rejected" | "expired";
export type TrustLevel = "trusted" | "internal" | "untrusted";
export type SourceType = "operator" | "agent_planner" | "internal_system" | "external_feed";
export type FindingOutcome = "pass" | "info" | "challenge" | "block";
export type OperatorRole = "dispatcher" | "logistics_officer" | "hospital_coordinator" | "supervisor";

/** Arbitrary JSON returned by the server (audit payloads, evidence, benchmark files). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ------------------------------------------------------------------ session & platform

export interface Person {
  id: string;
  name: string;
  role: string;
}

export interface SupervisorIdentity extends Person {
  title: string;
}

export interface Supervisor extends SupervisorIdentity {
  /** Demo supervisor credential for this sandbox; sent only as the X-IG-Supervisor header. */
  credential: string;
}

export interface SessionInfo {
  session_id: string;
  supervisor: Supervisor;
  operators: Record<string, Person>;
  server_time: number;
  note?: string;
}

export interface SessionCheck {
  session_id: string;
  created_at: number;
  server_time: number;
}

/**
 * Accelerator facts reported by the serving runtime. Field sets differ per runtime (e.g. torch:
 * requested_device/parameter_device/torch_nnpa/max_abs_prob_diff_vs_cpu; keras: tf_physical_devices),
 * so everything beyond `device` and `verified` is optional and rendered generically.
 */
export interface Accelerator {
  device: string;
  verified: boolean;
  nnpa_device_listed?: boolean;
  nnpa_disabled_by_env?: boolean;
  tf_physical_devices?: string[];
  requested_device?: string;
  parameter_device?: string;
  torch_nnpa?: JsonObject;
  max_abs_prob_diff_vs_cpu?: number | null;
  [key: string]: JsonValue | undefined;
}

export interface Health {
  status: string;
  version: string;
  uptime_s: number;
  model: { available: boolean; runtime: string; version: string; accelerator: Accelerator };
  platform: { architecture: string; is_ibm_z: boolean; machine_model: string | null; os: string };
  server_time: number;
}

export interface RiskModelInfo {
  available: boolean;
  kind: string;
  runtime: string;
  version: string;
  accelerator: Accelerator;
  thresholds: Record<string, number>;
  inference_count: number;
  last_error: string | null;
  meta: JsonObject;
}

export interface InjectionDetectorInfo {
  runtime: string;
  version: string;
}

export interface ExplainerInfo {
  available: boolean;
  backend: string | null;
  model: string | null;
  reason: string | null;
  role: string;
}

export interface MemoryInfo {
  process_rss_mb: number | null;
  host_total_mb: number | null;
  host_available_mb: number | null;
}

export interface ChainHead {
  seq: number;
  hash: string;
}

export interface EvidenceFile {
  file: string;
  bytes: number;
}

export interface PlatformInfo {
  architecture: string;
  is_ibm_z: boolean;
  system: string;
  kernel: string;
  os: string;
  cpu_vendor: string | null;
  machine_type: string | null;
  machine_model: string | null;
  cpu_count: number | null;
  hypervisor: string | null;
  virtualization: string | null;
  lscpu_model: string | null;
  cpu_features: string[];
  nnpa_facility_detected: boolean;
  python: string;
  packages: Record<string, string | null>;
  in_container: boolean;
  uptime_s: number;
  memory: MemoryInfo;
  load_avg: number[] | null;
  pid: number;
  model: RiskModelInfo;
  injection_detector: InjectionDetectorInfo;
  explainer: ExplainerInfo;
  audit: ChainHead;
  evidence: EvidenceFile[];
}

export interface LatencyStats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
}

export type LatencyKey = "decision_ms" | "inference_ms" | "policy_ms" | "features_ms" | "end_to_end_ms";

export interface Metrics {
  uptime_s: number;
  decisions: number;
  verdicts: Partial<Record<Verdict, number>>;
  http_requests: number;
  latency: Partial<Record<LatencyKey, LatencyStats>>;
  inference_count: number;
  sessions_active: number;
  audit_records: number;
  memory: MemoryInfo;
  load_avg: number[] | null;
}

export interface ModelInfoResponse {
  risk_model: RiskModelInfo;
  injection_detector: InjectionDetectorInfo;
  explainer: ExplainerInfo;
}

/** /benchmark/results is keyed by result file name; contents are whatever the ML pipeline wrote. */
export type BenchmarkResults = Record<string, JsonValue>;

// ------------------------------------------------------------------ audit

export interface AuditRef {
  seq: number;
  ts: number;
  time: string;
  hash: string;
  prev_hash: string;
  event_type: string;
}

export interface AuditRecord {
  seq: number;
  ts: number;
  time: string;
  session_id: string;
  event_type: string;
  subject_id: string;
  payload: JsonObject;
  prev_hash: string;
  hash: string;
}

export interface AuditVerify {
  ok: boolean;
  records_checked: number;
  head_hash: string | null;
  first_bad_seq: number | null;
  reason: string;
  verified_at: string;
  duration_ms: number;
  algorithm: string;
}

// ------------------------------------------------------------------ city (static)

export type RoadClass = "expressway" | "arterial" | "local";

export interface CityNode {
  id: string;
  r: number;
  c: number;
  /** metres */
  x: number;
  /** metres */
  z: number;
  street: string;
}

export interface CityEdge {
  id: string;
  a: string;
  b: string;
  length_m: number;
  road_class: RoadClass;
  speed_kmh: number;
  name: string;
}

export interface CityHospital {
  id: string;
  name: string;
  node: string;
  specialties: string[];
  beds_total: number;
  icu_total: number;
  district: string;
}

export interface CityStation {
  id: string;
  name: string;
  node: string;
}

export interface CityBlock {
  id: string;
  r: number;
  c: number;
  x: number;
  z: number;
  district: string;
  height_bias: number;
  reserved_for: string | null;
}

export interface City {
  name: string;
  rows: number;
  cols: number;
  spacing_m: number;
  nodes: CityNode[];
  edges: CityEdge[];
  hospitals: CityHospital[];
  stations: CityStation[];
  blocks: CityBlock[];
}

export interface Agent {
  agent_id: string;
  name: string;
  role: string;
  capabilities: OperationType[];
  tools: string[];
  description: string;
  active: boolean;
}

export type FocusType = "ambulance" | "hospital" | "incident";

export interface ScenarioFocus {
  type: FocusType;
  id: string;
}

export interface Scenario {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  expected: string;
  agent_id: string;
  focus: ScenarioFocus;
}

// ------------------------------------------------------------------ simulation state

export interface SimPosition {
  x: number;
  z: number;
  heading: number;
  progress: number;
  moving: boolean;
  next_node: string;
}

export type AmbulanceStatus = "available" | "dispatched" | "transporting" | "at_hospital" | "returning";

export interface Ambulance {
  id: string;
  call_sign: string;
  station_id: string;
  status: AmbulanceStatus;
  node: string;
  route: string[];
  /** cumulative simulated seconds per route node */
  route_times: number[];
  /** lead-in point (metres) when a new route starts mid-edge */
  start_xz: [number, number] | null;
  /** server epoch seconds */
  departed_at: number;
  destination_hospital_id: string | null;
  incident_id: string | null;
  patient: string | null;
  ambient: boolean;
  last_action_id: string | null;
  position: SimPosition;
  destination_name: string | null;
}

export interface HospitalState {
  id: string;
  name: string;
  node: string;
  specialties: string[];
  status: "accepting" | "diverting";
  status_reason: string;
  beds_total: number;
  beds_available: number;
  icu_total: number;
  icu_available: number;
}

export interface Incident {
  id: string;
  kind: string;
  node: string;
  severity: number;
  description: string;
  status: string;
  assigned_ambulance: string | null;
  required_specialty: string;
}

export interface Closure {
  edge_id: string;
  reason: string;
  since: number;
}

export interface Purchase {
  action_id: string;
  intent_id: string;
  supplier_id: string;
  item_sku: string;
  quantity: number;
  total_usd: number;
  delivery_hospital_id: string;
  ts: number;
}

export interface IcuReservation {
  action_id: string;
  hospital_id: string;
  beds: number;
  ts: number;
  intent_id: string;
}

export interface RecordShare {
  action_id: string;
  record_id: string;
  recipient: string;
  ts: number;
}

export interface FeedItem {
  id: string;
  source: string;
  trust: TrustLevel;
  ts: number;
  text: string;
  malicious?: boolean;
}

export type ChallengeStatus = "pending" | "approved" | "rejected" | "executed" | "expired" | "refused";

export interface Challenge {
  challenge_id: string;
  decision_id: string;
  action_id: string;
  fingerprint: string;
  intent_id: string;
  intent_version: number;
  intent_operator: string | null;
  agent_id: string;
  review_codes: string[];
  review_findings: Finding[];
  required_role: string;
  required_approver: SupervisorIdentity;
  created_at: number;
  expires_at: number;
  status: ChallengeStatus;
  approved_by?: string;
  approved_at?: number;
  grant_id?: string;
  justification?: string;
}

export interface SimState {
  version: number;
  server_time: number;
  sim_speedup: number;
  ambulances: Ambulance[];
  hospitals: HospitalState[];
  incidents: Incident[];
  closures: Closure[];
  purchases: Purchase[];
  icu_reservations: IcuReservation[];
  record_shares: RecordShare[];
  feeds: FeedItem[];
  spend_total_usd: number;
  intents: HumanIntent[];
  challenges: Challenge[];
}

// ------------------------------------------------------------------ intents

export interface PermittedTargets {
  ambulances: string[];
  hospitals: string[];
  suppliers: string[];
  incidents: string[];
}

export interface FinancialConstraints {
  budget_usd: number;
  escalation_ceiling_usd: number;
  approver_role: "supervisor";
}

export interface RoutingConstraints {
  avoid_closed_roads: boolean;
  max_eta_min: number | null;
  require_accepting_hospital: boolean;
}

export interface ResourceLimits {
  max_icu_beds: number | null;
}

export interface HumanIntent {
  intent_id: string;
  version: number;
  operator_id: string;
  operator_role: OperatorRole;
  instruction: string;
  authorized_operations: OperationType[];
  permitted_targets: PermittedTargets;
  resource_limits: ResourceLimits;
  financial: FinancialConstraints | null;
  routing: RoutingConstraints;
  created_at: number;
  expires_at: number;
  nonce: string;
  signature: string;
}

export interface IntentCreate {
  operator_id: string;
  operator_role: OperatorRole;
  instruction: string;
  authorized_operations: OperationType[];
  permitted_targets?: Partial<PermittedTargets>;
  resource_limits?: Partial<ResourceLimits>;
  financial?: { budget_usd: number; escalation_ceiling_usd: number; approver_role: "supervisor" } | null;
  routing?: Partial<RoutingConstraints>;
  ttl_minutes?: number;
}

// ------------------------------------------------------------------ actions & decisions

export type ParamValue = string | number | boolean | null | string[];
export type ActionParameters = Record<string, ParamValue>;

export interface Provenance {
  source_id: string;
  source_type: SourceType;
  trust: TrustLevel;
  influenced_fields: string[];
  excerpt: string;
}

export interface AgentActionIn {
  agent_id: string;
  intent_id: string;
  intent_version: number;
  action_type: OperationType;
  tool: string;
  target: string;
  parameters: ActionParameters;
  provenance?: Provenance[];
  rationale?: string;
  required_permissions?: string[];
}

export interface AgentAction {
  agent_id: string;
  intent_id: string;
  intent_version: number;
  action_type: OperationType;
  tool: string;
  target: string;
  parameters: ActionParameters;
  provenance: Provenance[];
  rationale: string;
  required_permissions: string[];
  action_id: string;
  session_id: string;
  created_at: number;
  fingerprint: string;
}

export interface Finding {
  code: string;
  check: string;
  outcome: FindingOutcome;
  message: string;
  evidence: JsonObject;
}

export interface RiskFactor {
  feature: string;
  value: number;
  weight: number;
}

export interface RiskEstimate {
  p_allow: number;
  p_challenge: number;
  p_block: number;
  risk_score: number;
  ml_verdict: Verdict;
  thresholds: Record<string, number>;
  top_factors: RiskFactor[];
  runtime: string;
  model_version: string;
}

export interface TrustBoundary {
  crossed: boolean;
  untrusted_sources: string[];
  influenced_fields: string[];
  description: string;
}

export interface LatencyBreakdown {
  decision_ms?: number;
  policy_ms?: number;
  features_ms?: number;
  inference_ms?: number;
  end_to_end_ms?: number;
}

export interface TraceStep {
  step: string;
  t_ms: number;
  [key: string]: JsonValue | undefined;
}

export interface DecisionAudit {
  proposed?: AuditRef;
  decision?: AuditRef;
  outcome?: AuditRef;
}

export interface Decision {
  decision_id: string;
  action_id: string;
  session_id: string;
  verdict: Verdict;
  hard_verdict: Verdict;
  status: DecisionStatus;
  findings: Finding[];
  risk: RiskEstimate | null;
  explanation: string;
  fingerprint: string;
  intent: HumanIntent | null;
  action: AgentAction;
  features: Record<string, number>;
  trust_boundary: TrustBoundary | null;
  ghost_route: string[] | null;
  executed_route: string[] | null;
  /** Snapshot of the challenge at decision time; live status lives in SimState.challenges. */
  challenge: Challenge | null;
  latency_ms: LatencyBreakdown;
  audit: DecisionAudit;
  timestamp: number;
  simulated_adversary: boolean;
  trace: TraceStep[];
}

export interface DecisionSummary {
  decision_id: string;
  action_id: string;
  verdict: Verdict;
  status: DecisionStatus;
  agent_id: string;
  action_type: OperationType;
  target: string;
  risk_score: number | null;
  decision_ms: number | null;
  timestamp: number;
  simulated_adversary: boolean;
  explanation: string;
}

export interface ScenarioRunResult {
  scenario: Scenario | { id: string };
  intent: HumanIntent;
  decisions: Decision[];
  feed?: FeedItem;
}

export interface TraceResponse {
  decision_id: string;
  verdict: Verdict;
  status: DecisionStatus;
  trace: TraceStep[];
  audit_records: AuditRecord[];
  latency_ms: LatencyBreakdown;
  chain: ChainHead;
}

export interface ExplainResponse {
  text: string;
  model: string;
  backend: string;
  tokens: number | null;
  latency_ms: number;
  grounding: string;
  cached?: boolean;
}

export interface ApproveRequest {
  approver_id: string;
  approver_role: string;
  reviewed_fingerprint: string;
  justification: string;
}

export interface ApproveResponse {
  grant: string;
  grant_id: string;
  expires_at: number;
  ttl_s: number;
  audit: AuditRef;
}

export interface ExecuteResponse {
  status: "executed";
  execution: JsonObject;
  revalidation: Finding[];
  audit: AuditRef;
}

export interface RejectResponse {
  status: "rejected";
  audit: AuditRef;
}

export interface ConditionChange {
  kind: "close_road" | "reopen_road" | "hospital";
  edge_id?: string;
  hospital_id?: string;
  status?: "accepting" | "diverting";
  beds_available?: number;
  icu_available?: number;
  reason?: string;
}

// ------------------------------------------------------------------ live events (SSE)

export type LiveEvent =
  | { type: "hello"; state_version: number; server_time: number }
  | { type: "decision"; decision_id: string; verdict: Verdict; status: DecisionStatus; state_version: number }
  | { type: "challenge"; challenge_id: string; status: string }
  | { type: "execution"; action_id: string; state_version: number }
  | { type: "scenario"; scenario: string; state_version: number }
  | { type: "state"; state_version: number }
  | { type: "ping"; server_time: number };
