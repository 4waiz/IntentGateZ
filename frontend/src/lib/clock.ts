/**
 * Server clock estimate. Ambulance positions are a pure function of backend route data and
 * server time, so the client only needs to know "what time is it on the server".
 */

let offsetS = 0;
let samples = 0;
let bestRttMs = Number.POSITIVE_INFINITY;

export function observeServerTime(serverTime: number, sentAtPerfMs: number, receivedAtPerfMs: number): void {
  const rtt = receivedAtPerfMs - sentAtPerfMs;
  if (!Number.isFinite(serverTime) || rtt < 0 || rtt > 2500) return;
  // Convert the request midpoint (performance clock) to wall-clock seconds.
  const midWallMs = Date.now() - (performance.now() - (sentAtPerfMs + receivedAtPerfMs) / 2);
  const sample = serverTime - midWallMs / 1000;
  if (samples === 0) {
    offsetS = sample;
  } else {
    // Trust low-latency samples more; drift slowly so vehicles never visibly jump.
    const weight = rtt <= bestRttMs * 1.5 ? 0.2 : 0.05;
    offsetS = offsetS * (1 - weight) + sample * weight;
  }
  bestRttMs = Math.min(bestRttMs, rtt);
  samples += 1;
}

export function serverNow(): number {
  return Date.now() / 1000 + offsetS;
}

export function clockOffset(): number {
  return offsetS;
}
