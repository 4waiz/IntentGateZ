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
  source.onopen = () => setState({ liveConnected: true });
  source.onmessage = (m: MessageEvent<string>) => {
    let ev: LiveEvent;
    try {
      ev = JSON.parse(m.data) as LiveEvent;
    } catch {
      return;
    }
    if (ev.type === "ping") return;
    setState({ liveConnected: true });
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
  );
}

setReconnectHandler(() => {
  connect();
  startLive();
});
