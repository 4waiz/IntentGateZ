import { api } from "../api/client";
import type { LiveEvent } from "../api/types";
import { refreshAudit, refreshDecisions, refreshHealth, refreshState, setReconnectHandler } from "./actions";
import { getState, setState } from "./store";

/**
 * Live updates: server-sent events trigger an immediate refetch; polling (state every second,
 * decisions and audit less often) is the fallback when the stream is unavailable.
 */
let es: EventSource | null = null;
let retryTimer: number | null = null;
/** The server pings every 15 s; silence for longer than this means the stream is stale. */
const STALE_MS = 25000;
let lastMessageAt = 0;
let refreshTimer: number | null = null;
const intervals: number[] = [];

function scheduleRefresh(): void {
  if (refreshTimer !== null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refreshState();
    void refreshDecisions();
    void refreshAudit();
  }, 60);
}

function connect(): void {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
  es?.close();
  es = null;
  const id = getState().session?.session_id;
  if (!id) return;
  const source = new EventSource(api.eventsUrl(id));
  es = source;
  lastMessageAt = Date.now();
  source.onopen = () => {
    lastMessageAt = Date.now();
    setState({ liveConnected: true });
  };
  source.onmessage = (m: MessageEvent<string>) => {
    lastMessageAt = Date.now();
    let ev: LiveEvent;
    try {
      ev = JSON.parse(m.data) as LiveEvent;
    } catch {
      return;
    }
    if (!getState().liveConnected) setState({ liveConnected: true });
    if (ev.type === "ping") return;
    scheduleRefresh();
  };
  source.onerror = () => {
    setState({ liveConnected: false });
    if (source.readyState === EventSource.CLOSED && es === source) {
      retryTimer = window.setTimeout(connect, 3000);
    }
  };
}

export function startLive(): void {
  if (intervals.length) return;
  intervals.push(
    window.setInterval(() => void refreshState(), 1000),
    window.setInterval(() => void refreshDecisions(), 4000),
    window.setInterval(() => void refreshAudit(), 7000),
    window.setInterval(() => void refreshHealth(), 5000),
    window.setInterval(() => {
      // A proxied stream can hang silently (e.g. the gateway restarted): reconnect.
      if (es && Date.now() - lastMessageAt > STALE_MS) {
        setState({ liveConnected: false });
        connect();
      }
    }, 5000),
  );
}

setReconnectHandler(() => {
  connect();
  startLive();
});
