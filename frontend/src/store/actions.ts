import { api, ApiError, setSessionProvider } from "../api/client";
import type {
  AgentActionIn,
  Challenge,
  ConditionChange,
  Decision,
  DecisionSummary,
  HumanIntent,
  IntentCreate,
  ScenarioFocus,
  ScenarioRunResult,
  SessionInfo,
  SimState,
  Verdict,
} from "../api/types";
import { observeServerTime, serverNow } from "../lib/clock";
import { buildCityIndex, facilityWorld, nodeWorld } from "../lib/geo";
import { buildRoutePath, sampleRoute, type RouteSample } from "../lib/sim";
import {
  type ChallengeUI,
  type GrantInfo,
  type ServerLogEntry,
  commandCamera,
  getState,
  setState,
  toast,
} from "./store";

const SESSION_KEY = "intentgate.session.v1";

// ------------------------------------------------------------------ session

function loadSavedSession(): SessionInfo | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionInfo;
    return typeof s?.session_id === "string" && typeof s?.supervisor?.credential === "string" ? s : null;
  } catch {
    return null;
  }
}

function saveSession(s: SessionInfo): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the session simply will not survive a reload */
  }
}

let renewing: Promise<string> | null = null;
let reconnectHandler: (() => void) | null = null;

export function setReconnectHandler(fn: () => void): void {
  reconnectHandler = fn;
}

function clearSessionScopedState(): void {
  setState({
    sim: null,
    decisions: [],
    decisionCache: {},
    latestId: null,
    recentAudit: [],
    effects: [],
    challengeUI: {},
    explain: {},
    scenarioRuns: {},
    selectedDecisionId: null,
    followLatest: true,
    traceDecisionId: null,
  });
}

async function createSession(): Promise<SessionInfo> {
  const s = await api.createSession();
  saveSession(s);
  setState({ session: s });
  return s;
}

async function restoreOrCreateSession(): Promise<SessionInfo> {
  const saved = loadSavedSession();
  if (saved) {
    try {
      await api.checkSession(saved.session_id);
      setState({ session: saved });
      return saved;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
    }
  }
  return createSession();
}

/** Called by the API client on 401: the sandbox expired, so start a fresh one. */
export function renewSession(): Promise<string> {
  if (!renewing) {
    renewing = (async () => {
      const s = await createSession();
      clearSessionScopedState();
      toast("info", "New sandbox session", "The previous session expired; a fresh isolated sandbox was created.");
      reconnectHandler?.();
      return s.session_id;
    })().finally(() => {
      renewing = null;
    });
  }
  return renewing;
}

setSessionProvider({ getId: () => getState().session?.session_id ?? null, renew: renewSession });

// ------------------------------------------------------------------ errors

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.code && !err.code.startsWith("http_") ? `${err.code}: ${err.message}` : err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function noteBackendError(err: unknown): void {
  if (err instanceof ApiError && err.isNetwork) {
    setState({ backendOk: false, backendError: err.message });
  }
}

// ------------------------------------------------------------------ bootstrap & refresh

export async function bootstrap(): Promise<void> {
  setState({ boot: "loading", bootError: null, bootStep: "Contacting gateway" });
  try {
    const health = await api.health();
    setState({ health, backendOk: true, backendError: null, bootStep: "Establishing isolated sandbox" });
    await restoreOrCreateSession();
    setState({ bootStep: "Loading city model" });
    const [city, agents, scenarios, platform] = await Promise.all([
      api.city(),
      api.agents(),
      api.scenarios(),
      api.platform().catch(() => null),
    ]);
    setState({ city, cityIndex: buildCityIndex(city), agents, scenarios, platform, bootStep: "Synchronising simulation" });
    await refreshState(true);
    await refreshDecisions(true);
    void refreshAudit();
    setState({ boot: "ready" });
    reconnectHandler?.();
  } catch (err) {
    setState({ boot: "error", bootError: errorText(err), backendOk: !(err instanceof ApiError && err.isNetwork) });
  }
}

let stateInflight = false;

export async function refreshState(throwOnError = false): Promise<SimState | null> {
  if (stateInflight) return getState().sim;
  stateInflight = true;
  let sent = 0;
  let received = 0;
  try {
    const sim = await api.state((s, r) => {
      sent = s;
      received = r;
    });
    observeServerTime(sim.server_time, sent, received);
    setState({ sim, backendOk: true, backendError: null });
    return sim;
  } catch (err) {
    noteBackendError(err);
    if (throwOnError) throw err;
    return null;
  } finally {
    stateInflight = false;
  }
}

export async function refreshHealth(): Promise<void> {
  try {
    const health = await api.health();
    setState({ health, backendOk: true, backendError: null });
  } catch (err) {
    noteBackendError(err);
  }
}

export async function refreshPlatform(): Promise<void> {
  try {
    setState({ platform: await api.platform() });
  } catch (err) {
    noteBackendError(err);
  }
}

export async function refreshAudit(): Promise<void> {
  try {
    const recentAudit = await api.audit(16, "session");
    setState({ recentAudit });
  } catch (err) {
    noteBackendError(err);
  }
}

const seen = new Set<string>();
const inflight = new Set<string>();

function newestId(list: DecisionSummary[], cache: Record<string, Decision>): string | null {
  let best: { id: string; ts: number } | null = null;
  for (const s of list) if (!best || s.timestamp > best.ts) best = { id: s.decision_id, ts: s.timestamp };
  for (const d of Object.values(cache)) if (!best || d.timestamp > best.ts) best = { id: d.decision_id, ts: d.timestamp };
  return best?.id ?? null;
}

let decisionsInflight = false;

export async function refreshDecisions(initial = false): Promise<void> {
  if (decisionsInflight) return;
  decisionsInflight = true;
  try {
    const list = await api.decisions(50);
    const { decisionCache } = getState();
    if (initial) for (const s of list) seen.add(s.decision_id);
    // Drop cached decisions the server no longer knows (e.g. after a reset).
    const ids = new Set(list.map((s) => s.decision_id));
    const pruned: Record<string, Decision> = {};
    for (const [k, v] of Object.entries(decisionCache)) if (ids.has(k)) pruned[k] = v;
    setState({ decisions: list, decisionCache: pruned, latestId: newestId(list, pruned) });
    const stale = list.filter((s) => !pruned[s.decision_id] || pruned[s.decision_id].status !== s.status).slice(0, 24);
    await Promise.all(stale.map((s) => fetchDecision(s.decision_id)));
  } catch (err) {
    noteBackendError(err);
  } finally {
    decisionsInflight = false;
  }
}

export async function fetchDecision(id: string): Promise<Decision | null> {
  if (inflight.has(id)) return null;
  inflight.add(id);
  try {
    const d = await api.decision(id);
    ingestDecision(d);
    return d;
  } catch (err) {
    noteBackendError(err);
    return null;
  } finally {
    inflight.delete(id);
  }
}

function ingestDecision(d: Decision): void {
  const isNew = !seen.has(d.decision_id);
  seen.add(d.decision_id);
  setState((s) => {
    const decisionCache = { ...s.decisionCache, [d.decision_id]: d };
    const decisions = s.decisions.some((x) => x.decision_id === d.decision_id)
      ? s.decisions.map((x) => (x.decision_id === d.decision_id ? { ...x, status: d.status } : x))
      : [summarise(d), ...s.decisions];
    return { decisionCache, decisions, latestId: newestId(decisions, decisionCache) };
  });
  if (isNew) spawnEffect(d);
}

function summarise(d: Decision): DecisionSummary {
  return {
    decision_id: d.decision_id,
    action_id: d.action_id,
    verdict: d.verdict,
    status: d.status,
    agent_id: d.action.agent_id,
    action_type: d.action.action_type,
    target: d.action.target,
    risk_score: d.risk ? d.risk.risk_score : null,
    decision_ms: d.latency_ms.decision_ms ?? null,
    timestamp: d.timestamp,
    simulated_adversary: d.simulated_adversary,
    explanation: d.explanation,
  };
}

// ------------------------------------------------------------------ world positions & effects

const tmpSample: RouteSample = { x: 0, z: 0, moving: false, dist: 0, dirX: 0, dirZ: 1 };

export function ambulanceWorld(id: string): [number, number] | null {
  const { sim, cityIndex } = getState();
  if (!sim || !cityIndex) return null;
  const amb = sim.ambulances.find((a) => a.id === id);
  if (!amb) return null;
  const path = buildRoutePath(amb, cityIndex);
  if (!path) return nodeWorld(cityIndex, amb.node);
  sampleRoute(path, serverNow(), sim.sim_speedup, tmpSample);
  return [tmpSample.x, tmpSample.z];
}

export function hospitalWorld(id: string): [number, number] | null {
  const { cityIndex } = getState();
  const h = cityIndex?.hospitals.get(id);
  return cityIndex && h ? facilityWorld(cityIndex, h.node) : null;
}

export function incidentWorld(id: string): [number, number] | null {
  const { sim, cityIndex } = getState();
  const inc = sim?.incidents.find((i) => i.id === id);
  return cityIndex && inc ? nodeWorld(cityIndex, inc.node) : null;
}

export function focusWorld(f: ScenarioFocus): [number, number] | null {
  if (f.type === "ambulance") return ambulanceWorld(f.id);
  if (f.type === "hospital") return hospitalWorld(f.id);
  return incidentWorld(f.id);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Where on the map a decision "happens" (for intervention effects and camera framing). */
export function decisionWorld(d: Decision): [number, number] | null {
  const { cityIndex } = getState();
  if (!cityIndex) return null;
  const p = d.action.parameters;
  switch (d.action.action_type) {
    case "reroute_ambulance":
    case "dispatch_ambulance":
    case "cancel_dispatch": {
      if (d.verdict === "BLOCK" && d.ghost_route && d.ghost_route.length) return nodeWorld(cityIndex, d.ghost_route[0]);
      const amb = str(p.ambulance_id);
      return amb ? ambulanceWorld(amb) : null;
    }
    case "purchase_supplies": {
      const h = str(p.delivery_hospital_id);
      return h ? hospitalWorld(h) : null;
    }
    case "reserve_icu_beds":
    case "update_hospital_status": {
      const h = str(p.hospital_id);
      return h ? hospitalWorld(h) : null;
    }
    default:
      return null;
  }
}

function spawnEffect(d: Decision): void {
  const pos = decisionWorld(d);
  if (!pos) return;
  const effect = { key: `${d.decision_id}`, verdict: d.verdict as Verdict, x: pos[0], z: pos[1], born: performance.now() };
  setState((s) => ({ effects: [...s.effects.filter((e) => performance.now() - e.born < 4000), effect].slice(-8) }));
}

// ------------------------------------------------------------------ scenarios & sandbox

function setBusy(key: string, on: boolean): void {
  setState((s) => ({ busy: { ...s.busy, [key]: on } }));
}

export function focusEntity(f: ScenarioFocus): void {
  commandCamera(f.type, f.id);
}

export async function runScenario(id: string, opts: { focus?: boolean; quiet?: boolean } = {}): Promise<ScenarioRunResult | null> {
  const key = `scenario:${id}`;
  if (getState().busy[key]) return null;
  setBusy(key, true);
  const sc = getState().scenarios.find((s) => s.id === id);
  try {
    const res = await api.runScenario(id);
    for (const d of res.decisions) ingestDecision(d);
    setState((s) => ({
      followLatest: true,
      selectedDecisionId: null,
      scenarioRuns: { ...s.scenarioRuns, [id]: res.decisions.map((d) => d.decision_id) },
    }));
    await Promise.all([refreshState(), refreshDecisions()]);
    // Frame the scenario's focus entity once the server has staged it.
    if (sc && opts.focus !== false) focusEntity(sc.focus);
    void refreshAudit();
    return res;
  } catch (err) {
    if (!opts.quiet) toast("error", `Scenario "${sc?.title ?? id}" failed`, errorText(err));
    noteBackendError(err);
    if (opts.quiet) throw err;
    return null;
  } finally {
    setBusy(key, false);
  }
}

export async function resetSandbox(): Promise<boolean> {
  setBusy("reset", true);
  try {
    const sim = await api.reset();
    setState({
      sim,
      decisions: [],
      decisionCache: {},
      latestId: null,
      selectedDecisionId: null,
      followLatest: true,
      challengeUI: {},
      explain: {},
      effects: [],
      scenarioRuns: {},
      traceDecisionId: null,
      cameraMode: "static",
      followId: null,
    });
    void refreshAudit();
    commandCamera("overview");
    return true;
  } catch (err) {
    toast("error", "Reset failed", errorText(err));
    return false;
  } finally {
    setBusy("reset", false);
  }
}

// ------------------------------------------------------------------ challenge workflow

function cui(id: string): ChallengeUI {
  return getState().challengeUI[id] ?? { grant: null, executed: false, log: [], busy: null };
}

function patchCui(id: string, patch: Partial<ChallengeUI>): void {
  setState((s) => ({ challengeUI: { ...s.challengeUI, [id]: { ...cui(id), ...patch } } }));
}

function logCui(id: string, entry: Omit<ServerLogEntry, "at">): void {
  const c = cui(id);
  patchCui(id, { log: [...c.log, { ...entry, at: Date.now() }] });
}

function errorEntry(action: string, err: unknown, expectedRefusal = false): Omit<ServerLogEntry, "at"> {
  if (err instanceof ApiError) {
    const detail = err.detail === undefined || typeof err.detail === "string" ? undefined : JSON.stringify(err.detail).slice(0, 400);
    return { action, ok: false, http: err.status, code: err.code, message: err.message, detail, expectedRefusal };
  }
  return { action, ok: false, http: 0, code: "client_error", message: errorText(err) };
}

function pin(decisionId: string): void {
  setState({ followLatest: false, selectedDecisionId: decisionId });
}

export async function approveChallenge(ch: Challenge, justification: string): Promise<GrantInfo | null> {
  const session = getState().session;
  if (!session) return null;
  pin(ch.decision_id);
  patchCui(ch.challenge_id, { busy: "approve" });
  try {
    const r = await api.approve(
      ch.challenge_id,
      { approver_id: session.supervisor.id, approver_role: session.supervisor.role, reviewed_fingerprint: ch.fingerprint, justification },
      session.supervisor.credential,
    );
    const grant: GrantInfo = { grant: r.grant, grant_id: r.grant_id, expires_at: r.expires_at, ttl_s: r.ttl_s };
    patchCui(ch.challenge_id, { grant });
    logCui(ch.challenge_id, {
      action: "POST /challenges/{id}/approve",
      ok: true,
      http: 200,
      code: "grant_issued",
      message: `Single-use grant ${r.grant_id} issued by ${session.supervisor.name}; valid ${r.ttl_s}s; audit seq ${r.audit.seq}.`,
    });
    return grant;
  } catch (err) {
    logCui(ch.challenge_id, errorEntry("POST /challenges/{id}/approve", err));
    return null;
  } finally {
    patchCui(ch.challenge_id, { busy: null });
    void refreshState();
    void refreshAudit();
  }
}

export async function executeWithGrant(ch: Challenge, mode: "execute" | "replay"): Promise<boolean> {
  const c = cui(ch.challenge_id);
  if (!c.grant) return false;
  pin(ch.decision_id);
  patchCui(ch.challenge_id, { busy: mode });
  const label = mode === "replay" ? "Replay: POST /actions/{id}/execute (same grant)" : "POST /actions/{id}/execute";
  try {
    const r = await api.execute(ch.action_id, c.grant.grant);
    patchCui(ch.challenge_id, { executed: true });
    const sv = r.execution?.state_version;
    logCui(ch.challenge_id, {
      action: label,
      ok: true,
      http: 200,
      code: r.status,
      message: `Hard policy re-validated (${r.revalidation.filter((f) => f.outcome === "pass").length} checks passed); action executed${typeof sv === "number" ? `, state v${sv}` : ""}; audit seq ${r.audit.seq}.`,
    });
    return true;
  } catch (err) {
    logCui(ch.challenge_id, errorEntry(label, err, mode === "replay"));
    return false;
  } finally {
    patchCui(ch.challenge_id, { busy: null });
    await Promise.all([refreshState(), refreshDecisions()]);
    void fetchDecision(ch.decision_id);
    void refreshAudit();
  }
}

/**
 * Security test: change the approved action (quantity +200, total recomputed), submit it to the
 * gateway as a new proposal, then try to execute the new action with the old grant.
 */
export async function tamperAndReuse(ch: Challenge, d: Decision): Promise<void> {
  const c = cui(ch.challenge_id);
  if (!c.grant) return;
  pin(ch.decision_id);
  patchCui(ch.challenge_id, { busy: "tamper" });
  const a = d.action;
  const params = { ...a.parameters };
  let change = "";
  if (typeof params.quantity === "number" && typeof params.unit_price_usd === "number") {
    params.quantity = params.quantity + 200;
    params.total_usd = Math.round(params.quantity * params.unit_price_usd * 100) / 100;
    change = `quantity ${a.parameters.quantity} -> ${params.quantity}, total recomputed`;
  } else if (typeof params.beds === "number") {
    params.beds = params.beds + 1;
    change = `beds ${a.parameters.beds} -> ${params.beds}`;
  } else {
    patchCui(ch.challenge_id, { busy: null });
    return;
  }
  const body: AgentActionIn = {
    agent_id: a.agent_id,
    intent_id: a.intent_id,
    intent_version: a.intent_version,
    action_type: a.action_type,
    tool: a.tool,
    target: a.target,
    parameters: params,
    provenance: a.provenance,
    rationale: `${a.rationale} [tampered after approval: ${change}]`,
    required_permissions: a.required_permissions,
  };
  try {
    const nd = await api.evaluate(body);
    ingestDecision(nd);
    logCui(ch.challenge_id, {
      action: "POST /actions/evaluate (tampered copy)",
      ok: true,
      http: 200,
      code: nd.verdict,
      message: `Gateway treated it as a new action ${nd.action_id} (${change}) -> ${nd.verdict}, status ${nd.status}.`,
    });
    try {
      await api.execute(nd.action_id, c.grant.grant);
      logCui(ch.challenge_id, {
        action: "POST /actions/{new_id}/execute (old grant)",
        ok: true,
        http: 200,
        code: "executed",
        message: "Server executed the tampered action with the old grant.",
      });
    } catch (err) {
      logCui(ch.challenge_id, errorEntry("POST /actions/{new_id}/execute (old grant)", err, true));
    }
  } catch (err) {
    logCui(ch.challenge_id, errorEntry("POST /actions/evaluate (tampered copy)", err));
  } finally {
    patchCui(ch.challenge_id, { busy: null });
    pin(ch.decision_id);
    await Promise.all([refreshState(), refreshDecisions()]);
    void refreshAudit();
  }
}

export async function rejectChallenge(ch: Challenge, reason: string): Promise<void> {
  const session = getState().session;
  if (!session) return;
  pin(ch.decision_id);
  patchCui(ch.challenge_id, { busy: "reject" });
  try {
    const r = await api.reject(ch.challenge_id, { approver_id: session.supervisor.id, reason }, session.supervisor.credential);
    logCui(ch.challenge_id, {
      action: "POST /challenges/{id}/reject",
      ok: true,
      http: 200,
      code: r.status,
      message: `Rejected by ${session.supervisor.name}; the action will not execute; audit seq ${r.audit.seq}.`,
    });
  } catch (err) {
    logCui(ch.challenge_id, errorEntry("POST /challenges/{id}/reject", err));
  } finally {
    patchCui(ch.challenge_id, { busy: null });
    await Promise.all([refreshState(), refreshDecisions()]);
    void fetchDecision(ch.decision_id);
    void refreshAudit();
  }
}

// ------------------------------------------------------------------ explanation (local Granite)

export async function explainDecision(id: string): Promise<void> {
  setState((s) => ({ explain: { ...s.explain, [id]: { status: "loading" } } }));
  try {
    const r = await api.explain(id);
    const meta = `${r.model} via ${r.backend} · ${r.latency_ms} ms${r.tokens ? ` · ${r.tokens} tokens` : ""}${r.cached ? " · cached" : ""}`;
    setState((s) => ({ explain: { ...s.explain, [id]: { status: "ok", text: r.text, meta: `${meta}. ${r.grounding}` } } }));
  } catch (err) {
    const unavailable = err instanceof ApiError && err.status === 503;
    setState((s) => ({
      explain: { ...s.explain, [id]: { status: unavailable ? "unavailable" : "error", message: err instanceof ApiError ? err.message : errorText(err) } },
    }));
  }
}

// ------------------------------------------------------------------ studio

export async function submitAction(body: AgentActionIn): Promise<Decision | null> {
  setBusy("studio:submit", true);
  try {
    const d = await api.evaluate(body);
    ingestDecision(d);
    setState({ followLatest: true, selectedDecisionId: null });
    await Promise.all([refreshState(), refreshDecisions()]);
    void refreshAudit();
    return d;
  } catch (err) {
    toast("error", "Gateway rejected the proposal", errorText(err), 8000);
    return null;
  } finally {
    setBusy("studio:submit", false);
  }
}

export async function changeConditions(body: ConditionChange, description: string): Promise<boolean> {
  setBusy("studio:conditions", true);
  try {
    const sim = await api.conditions(body);
    setState({ sim });
    toast("success", "Environment updated", description, 3000);
    void refreshAudit();
    return true;
  } catch (err) {
    toast("error", "Environment change refused", errorText(err));
    return false;
  } finally {
    setBusy("studio:conditions", false);
  }
}

export async function createIntent(body: IntentCreate): Promise<HumanIntent | null> {
  setBusy("studio:intent", true);
  try {
    const intent = await api.createIntent(body);
    toast("success", "Intent registered", `${intent.intent_id} v${intent.version} signed by the gateway.`, 3500);
    await refreshState();
    void refreshAudit();
    return intent;
  } catch (err) {
    toast("error", "Intent rejected", errorText(err), 8000);
    return null;
  } finally {
    setBusy("studio:intent", false);
  }
}
