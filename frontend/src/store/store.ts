import { create } from "zustand";
import type {
  Agent,
  AuditRecord,
  City,
  Decision,
  DecisionSummary,
  Health,
  PlatformInfo,
  Scenario,
  SessionInfo,
  SimState,
  Verdict,
} from "../api/types";
import type { CityIndex } from "../lib/geo";

export type View = "command" | "proof" | "audit" | "studio";
export type Quality = "low" | "med" | "high";

export type CameraPreset = "overview" | "orbit" | "ambulance" | "hospital" | "incident" | "follow" | "blocked" | "reset";

export interface CameraCommand {
  preset: CameraPreset;
  id?: string;
  nonce: number;
}

export type CameraMode = "static" | "orbit" | "follow";

export interface VerdictEffect {
  key: string;
  verdict: Verdict;
  x: number;
  z: number;
  /** performance.now() ms */
  born: number;
}

/** One server response in the challenge workflow log, shown verbatim-ish. */
export interface ServerLogEntry {
  at: number;
  action: string;
  ok: boolean;
  http: number;
  code: string;
  message: string;
  detail?: string;
  /** For security tests: the server refused, which is the expected safe outcome. */
  expectedRefusal?: boolean;
}

export interface GrantInfo {
  grant: string;
  grant_id: string;
  expires_at: number;
  ttl_s: number;
}

export interface ChallengeUI {
  grant: GrantInfo | null;
  executed: boolean;
  log: ServerLogEntry[];
  busy: string | null;
}

export type ToastTone = "info" | "success" | "warn" | "error";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

export interface ExplainState {
  status: "loading" | "ok" | "unavailable" | "error";
  text?: string;
  meta?: string;
  message?: string;
}

export interface AppState {
  boot: "loading" | "ready" | "error";
  bootStep: string;
  bootError: string | null;
  backendOk: boolean;
  backendError: string | null;
  liveConnected: boolean;

  session: SessionInfo | null;
  health: Health | null;
  platform: PlatformInfo | null;
  city: City | null;
  cityIndex: CityIndex | null;
  agents: Agent[];
  scenarios: Scenario[];
  sim: SimState | null;

  decisions: DecisionSummary[];
  decisionCache: Record<string, Decision>;
  latestId: string | null;
  recentAudit: AuditRecord[];
  effects: VerdictEffect[];
  challengeUI: Record<string, ChallengeUI>;
  explain: Record<string, ExplainState>;
  busy: Record<string, boolean>;

  view: View;
  quality: Quality;
  presentation: boolean;
  selectedDecisionId: string | null;
  followLatest: boolean;
  cameraCmd: CameraCommand | null;
  cameraMode: CameraMode;
  followId: string | null;
  hovered: { type: "ambulance" | "hospital" | "incident"; id: string } | null;
  traceDecisionId: string | null;
  toasts: Toast[];
}

function loadQuality(): Quality {
  try {
    const q = window.localStorage.getItem("intentgate.quality");
    if (q === "low" || q === "med" || q === "high") return q;
  } catch {
    /* storage unavailable */
  }
  return "med";
}

export const useStore = create<AppState>()(() => ({
  boot: "loading",
  bootStep: "Contacting gateway",
  bootError: null,
  backendOk: true,
  backendError: null,
  liveConnected: false,

  session: null,
  health: null,
  platform: null,
  city: null,
  cityIndex: null,
  agents: [],
  scenarios: [],
  sim: null,

  decisions: [],
  decisionCache: {},
  latestId: null,
  recentAudit: [],
  effects: [],
  challengeUI: {},
  explain: {},
  busy: {},

  view: "command",
  quality: loadQuality(),
  presentation: false,
  selectedDecisionId: null,
  followLatest: true,
  cameraCmd: null,
  cameraMode: "static",
  followId: null,
  hovered: null,
  traceDecisionId: null,
  toasts: [],
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

/** The decision the inspector shows: the latest one unless the user pinned another. */
export function currentDecisionId(s: AppState): string | null {
  return s.followLatest ? s.latestId : s.selectedDecisionId ?? s.latestId;
}

export function useCurrentDecision(): Decision | null {
  return useStore((s) => {
    const id = currentDecisionId(s);
    return id ? s.decisionCache[id] ?? null : null;
  });
}

let nonce = 1;
export function commandCamera(preset: CameraPreset, id?: string): void {
  setState({ cameraCmd: { preset, id, nonce: nonce++ } });
}

let toastId = 1;
export function toast(tone: ToastTone, title: string, message?: string, ttlMs = 5200): void {
  const id = toastId++;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone, title, message }] }));
  window.setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttlMs);
}

export function setQuality(q: Quality): void {
  try {
    window.localStorage.setItem("intentgate.quality", q);
  } catch {
    /* storage unavailable */
  }
  setState({ quality: q });
}

export function selectDecision(id: string | null): void {
  if (id === null) setState({ followLatest: true, selectedDecisionId: null });
  else setState({ followLatest: false, selectedDecisionId: id });
}
