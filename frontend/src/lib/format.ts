import type { JsonValue, OperationType } from "../api/types";
import { OPERATION_LABEL } from "./constants";

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function money(v: number | null | undefined, precise = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return precise || Math.abs(v) < 100 ? usd2.format(v) : usd0.format(v);
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return digits === 0 ? int.format(v) : v.toFixed(digits);
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (v < 1) return `${v.toFixed(3)} ms`;
  if (v < 10) return `${v.toFixed(2)} ms`;
  if (v < 1000) return `${v.toFixed(1)} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return `${(v * 100).toFixed(digits)}%`;
}

export function shortHash(h: string | null | undefined, n = 10): string {
  if (!h) return "n/a";
  return h.length > n ? `${h.slice(0, n)}…` : h;
}

export function clockTime(epochS: number | null | undefined): string {
  if (!epochS) return "--:--:--";
  const d = new Date(epochS * 1000);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function countdown(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "n/a";
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function opLabel(op: OperationType | string): string {
  return OPERATION_LABEL[op as OperationType] ?? op.replace(/_/g, " ");
}

export function humanize(s: string): string {
  const t = s.replace(/[_.]/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function jsonPreview(v: JsonValue | undefined, max = 120): string {
  if (v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
