import type {
  Agent,
  AgentActionIn,
  ApproveRequest,
  ApproveResponse,
  AuditRecord,
  AuditVerify,
  BenchmarkResults,
  Challenge,
  City,
  ConditionChange,
  Decision,
  DecisionSummary,
  ExecuteResponse,
  ExplainResponse,
  Health,
  HumanIntent,
  IntentCreate,
  JsonValue,
  Metrics,
  ModelInfoResponse,
  PlatformInfo,
  RejectResponse,
  Scenario,
  ScenarioRunResult,
  SessionCheck,
  SessionInfo,
  SimState,
  TraceResponse,
} from "./types";

/** Same-origin by default: production serves the SPA from the gateway origin on IBM LinuxONE. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

export const apiUrl = (path: string): string => `${API_BASE}/api${path}`;

/** Error carrying the gateway's own error code and message (never invented client-side). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: JsonValue | undefined;
  readonly body: JsonValue | undefined;

  constructor(status: number, code: string, message: string, detail?: JsonValue, body?: JsonValue) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.body = body;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

function isObject(v: unknown): v is Record<string, JsonValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toApiError(status: number, data: JsonValue | undefined): ApiError {
  if (isObject(data)) {
    // GatewayError: {error, message, detail}
    if (typeof data.error === "string") {
      const message = typeof data.message === "string" ? data.message : data.error.replace(/_/g, " ");
      return new ApiError(status, data.error, message, data.detail, data);
    }
    // FastAPI HTTPException: {detail: string} ; validation: {detail: [{msg, loc}]}
    const d = data.detail;
    if (typeof d === "string") return new ApiError(status, `http_${status}`, d, d, data);
    if (Array.isArray(d)) {
      const msgs = d
        .map((item) => {
          if (!isObject(item)) return String(item);
          const loc = Array.isArray(item.loc) ? item.loc.filter((p) => p !== "body").join(".") : "";
          return `${loc ? `${loc}: ` : ""}${typeof item.msg === "string" ? item.msg : "invalid"}`;
        })
        .join("; ");
      return new ApiError(status, status === 422 ? "validation_error" : `http_${status}`, msgs, d, data);
    }
  }
  const text = typeof data === "string" && data.length < 300 ? data : `HTTP ${status}`;
  return new ApiError(status, `http_${status}`, text, data ?? undefined, data ?? undefined);
}

interface SessionProvider {
  getId(): string | null;
  renew(): Promise<string>;
}

let sessionProvider: SessionProvider | null = null;

export function setSessionProvider(p: SessionProvider): void {
  sessionProvider = p;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  session?: boolean;
  headers?: Record<string, string>;
  retryOn401?: boolean;
  timeoutMs?: number;
  onTiming?: (sentAtMs: number, receivedAtMs: number) => void;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.session) {
    const id = sessionProvider?.getId();
    if (id) headers["X-IG-Session"] = id;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  let res: Response;
  const sentAt = performance.now();
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    window.clearTimeout(timer);
    const aborted = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(0, aborted ? "timeout" : "network_error", aborted ? "The gateway did not respond in time." : "The gateway is unreachable.");
  }
  window.clearTimeout(timer);
  const receivedAt = performance.now();

  if (res.status === 401 && opts.session && opts.retryOn401 !== false && sessionProvider) {
    await sessionProvider.renew();
    return request<T>(path, { ...opts, retryOn401: false });
  }

  const text = await res.text();
  let data: JsonValue | undefined;
  if (text) {
    try {
      data = JSON.parse(text) as JsonValue;
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw toApiError(res.status, data);
  opts.onTiming?.(sentAt, receivedAt);
  return data as T;
}

const S = { session: true } as const;

/**
 * Audit reads are issued one at a time. The backend's audit log shares one SQLite connection
 * across threads, so overlapping reads from this console could collide; queueing them keeps
 * the console from ever being the cause.
 */
let auditQueue: Promise<unknown> = Promise.resolve();
function serialAudit<T>(fn: () => Promise<T>): Promise<T> {
  const next = auditQueue.then(fn, fn);
  auditQueue = next.catch(() => undefined);
  return next;
}

export const api = {
  health: () => request<Health>("/health", { timeoutMs: 6000 }),
  platform: () => request<PlatformInfo>("/platform"),
  metrics: () => request<Metrics>("/metrics"),
  modelInfo: () => request<ModelInfoResponse>("/model/info"),
  benchmarkResults: () => request<BenchmarkResults>("/benchmark/results"),
  benchmarkChartUrl: (name: string) => apiUrl(`/benchmark/charts/${encodeURIComponent(name)}`),

  createSession: () => request<SessionInfo>("/session", { method: "POST" }),
  checkSession: (id: string) => request<SessionCheck>("/session", { headers: { "X-IG-Session": id } }),

  city: () => request<City>("/city"),
  agents: () => request<Agent[]>("/agents"),
  scenarios: () => request<Scenario[]>("/scenarios"),

  state: (onTiming?: RequestOptions["onTiming"]) => request<SimState>("/simulation/state", { ...S, onTiming, timeoutMs: 8000 }),
  conditions: (body: ConditionChange) => request<SimState>("/simulation/conditions", { ...S, method: "POST", body }),
  reset: () => request<SimState>("/scenarios/reset", { ...S, method: "POST" }),
  runScenario: (id: string) => request<ScenarioRunResult>(`/scenarios/${encodeURIComponent(id)}/run`, { ...S, method: "POST" }),

  intents: () => request<HumanIntent[]>("/intents", S),
  createIntent: (body: IntentCreate) => request<HumanIntent>("/intents", { ...S, method: "POST", body }),
  evaluate: (body: AgentActionIn) => request<Decision>("/actions/evaluate", { ...S, method: "POST", body }),
  action: (actionId: string) => request<Decision>(`/actions/${encodeURIComponent(actionId)}`, S),
  execute: (actionId: string, grant: string) =>
    request<ExecuteResponse>(`/actions/${encodeURIComponent(actionId)}/execute`, { ...S, method: "POST", body: { grant } }),

  decisions: (limit = 50) => request<DecisionSummary[]>(`/decisions?limit=${limit}`, S),
  decision: (id: string) => request<Decision>(`/decisions/${encodeURIComponent(id)}`, S),
  trace: (id: string) => serialAudit(() => request<TraceResponse>(`/decisions/${encodeURIComponent(id)}/trace`, S)),
  explain: (id: string) => request<ExplainResponse>(`/decisions/${encodeURIComponent(id)}/explain`, { ...S, method: "POST", timeoutMs: 60000 }),

  challenges: () => request<Challenge[]>("/challenges", S),
  approve: (id: string, body: ApproveRequest, supervisorCredential: string) =>
    request<ApproveResponse>(`/challenges/${encodeURIComponent(id)}/approve`, {
      ...S,
      method: "POST",
      body,
      headers: { "X-IG-Supervisor": supervisorCredential },
    }),
  reject: (id: string, body: { approver_id: string; reason: string }, supervisorCredential: string) =>
    request<RejectResponse>(`/challenges/${encodeURIComponent(id)}/reject`, {
      ...S,
      method: "POST",
      body,
      headers: { "X-IG-Supervisor": supervisorCredential },
    }),

  audit: (limit: number, scope: "session" | "all") =>
    serialAudit(() => request<AuditRecord[]>(`/audit?limit=${limit}&scope=${scope}`, { session: scope === "session" })),
  auditVerify: () => serialAudit(() => request<AuditVerify>("/audit/verify")),
  auditExportUrl: (sessionId?: string | null) => apiUrl(`/audit/export${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}`),
  eventsUrl: (sessionId: string) => apiUrl(`/events/stream?session=${encodeURIComponent(sessionId)}`),
};
