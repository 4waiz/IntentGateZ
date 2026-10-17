import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../../api/client";
import type { AuditRecord, AuditVerify } from "../../api/types";
import { ms, num, shortHash } from "../../lib/format";
import { useStore } from "../../store/store";
import { cx, CopyButton, Spinner } from "../ui/ui";

function eventTone(r: AuditRecord): string {
  const t = r.event_type;
  if (t === "decision.made") {
    const v = r.payload.verdict;
    return v === "BLOCK" ? "#FF5D70" : v === "CHALLENGE" ? "#FFBC5C" : "#00D5B5";
  }
  if (t === "action.executed") return "#00D5B5";
  if (t === "action.prevented" || t.endsWith("rejected") || t === "execution.refused" || t.endsWith("denied")) return "#FF5D70";
  if (t.startsWith("challenge.")) return "#FFBC5C";
  if (t.startsWith("grant.")) return "#FF5D70";
  if (t === "action.proposed") return "#4589FF";
  if (t === "environment.changed" || t === "intent.registered") return "#7FB0FF";
  return "#8496A8";
}

export default function AuditView() {
  const session = useStore((s) => s.session);
  const [scope, setScope] = useState<"session" | "all">("session");
  const [limit, setLimit] = useState(200);
  const [rows, setRows] = useState<AuditRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verify, setVerify] = useState<AuditVerify | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.audit(limit, scope));
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.status} ${e.message}` : String(e));
    } finally {
      setLoading(false);
    }
  }, [limit, scope]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const bySeq = useMemo(() => new Map((rows ?? []).map((r) => [r.seq, r] as const)), [rows]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows ?? [];
    return (rows ?? []).filter((r) => r.event_type.includes(f) || r.subject_id.toLowerCase().includes(f) || r.hash.startsWith(f));
  }, [rows, filter]);

  const exportHref = api.auditExportUrl(scope === "session" ? session?.session_id : null);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-6 py-4">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-end justify-between gap-4">
          <div>
            <div className="ig-label">Audit</div>
            <h1 className="mt-1 text-[20px] font-semibold text-fg">Tamper-evident audit chain</h1>
            <p className="mt-1 max-w-[760px] text-[12.5px] leading-relaxed text-muted">
              Every proposal, decision, approval and execution is appended as canonical JSON and chained with SHA-256: each record commits to the hash of the record
              before it. Editing, deleting or reordering any record breaks verification from that point on.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-7 items-center rounded-[4px] border border-line p-0.5">
              {(["session", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={cx("h-full rounded-[3px] px-2.5 text-[11px] font-medium", scope === s ? "bg-white/[0.09] text-fg" : "text-muted hover:text-fg")}
                >
                  {s === "session" ? "This session" : "All sessions"}
                </button>
              ))}
            </div>
            <select className="ig-input h-7 w-[92px] text-[11px]" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Rows">
              {[60, 200, 500, 1000].map((n) => (
                <option key={n} value={n}>
                  {n} rows
                </option>
              ))}
            </select>
            <input className="ig-input h-7 w-[200px] text-[11px]" placeholder="Filter type, subject or hash" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button type="button" className="ig-btn" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              type="button"
              className="ig-btn ig-btn-allow"
              disabled={verifying}
              onClick={async () => {
                setVerifying(true);
                try {
                  setVerify(await api.auditVerify());
                } finally {
                  setVerifying(false);
                }
              }}
            >
              {verifying ? <Spinner size={12} /> : <ShieldCheck size={13} />} Verify chain
            </button>
            <a className="ig-btn" href={exportHref} download="intentgate-audit.json">
              <Download size={13} /> Export JSON
            </a>
          </div>
        </div>
        {verify && (
          <div className="mx-auto mt-3 flex max-w-[1480px] flex-wrap items-center gap-x-6 gap-y-1 rounded-[5px] border px-3 py-2 text-[12px]" style={{ borderColor: verify.ok ? "rgba(0,213,181,0.45)" : "rgba(255,93,112,0.5)", background: verify.ok ? "rgba(0,213,181,0.06)" : "rgba(255,93,112,0.06)" }}>
            <span className={cx("font-semibold", verify.ok ? "text-allow" : "text-block")}>{verify.ok ? "Chain verified: intact" : `Chain broken at seq ${verify.first_bad_seq}`}</span>
            <span className="text-muted">
              records <span className="ig-mono text-fg">{num(verify.records_checked)}</span>
            </span>
            <span className="flex items-center gap-1 text-muted">
              head <span className="ig-mono text-fg">{shortHash(verify.head_hash, 20)}</span>
              {verify.head_hash && <CopyButton value={verify.head_hash} />}
            </span>
            <span className="text-muted">
              duration <span className="ig-mono text-fg">{ms(verify.duration_ms)}</span>
            </span>
            <span className="text-muted">{verify.algorithm}</span>
            {!verify.ok && <span className="text-block">{verify.reason}</span>}
            <span className="ig-mono ml-auto text-[10.5px] text-dim">{verify.verified_at}</span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-3">
        <div className="mx-auto max-w-[1480px]">
          {err && <div className={cx("text-[11.5px]", rows ? "pb-2 text-challenge" : "py-6 text-block")}>{rows ? `Last refresh failed (${err}); showing the previous listing.` : err}</div>}
          {!rows && !err && (
            <div className="flex items-center gap-2 py-6 text-[12px] text-muted">
              <Spinner size={12} /> Loading audit records…
            </div>
          )}
          {rows && (
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 z-10 bg-ink">
                <tr className="text-left text-muted">
                  <th className="w-6 py-2" />
                  <th className="py-2 font-medium">seq</th>
                  <th className="py-2 font-medium">time (UTC)</th>
                  <th className="py-2 font-medium">event</th>
                  <th className="py-2 font-medium">subject</th>
                  <th className="py-2 font-medium">session</th>
                  <th className="py-2 font-medium">hash</th>
                  <th className="py-2 font-medium">prev_hash</th>
                  <th className="py-2 text-right font-medium">link</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const prev = bySeq.get(r.seq - 1);
                  const linked = prev ? prev.hash === r.prev_hash : null;
                  const c = eventTone(r);
                  const isOpen = open === r.seq;
                  return (
                    <Fragment key={r.seq}>
                      <tr className={cx("cursor-pointer border-t border-white/[0.05] hover:bg-white/[0.02]", isOpen && "bg-white/[0.025]")} onClick={() => setOpen(isOpen ? null : r.seq)}>
                        <td className="py-1.5 text-dim">
                          <ChevronRight size={12} className={cx("transition-transform", isOpen && "rotate-90")} />
                        </td>
                        <td className="ig-mono py-1.5 text-fg">#{r.seq}</td>
                        <td className="ig-mono py-1.5 text-muted">{r.time.replace("T", " ").replace("Z", "")}</td>
                        <td className="py-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                            <span className="text-fg">{r.event_type}</span>
                            {r.event_type === "decision.made" && typeof r.payload.verdict === "string" && (
                              <span className="text-[10px] font-semibold tracking-[0.1em]" style={{ color: c }}>
                                {r.payload.verdict}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="ig-mono max-w-[200px] truncate py-1.5 text-fg-2" title={r.subject_id}>
                          {r.subject_id}
                        </td>
                        <td className="ig-mono py-1.5 text-dim" title={r.session_id}>
                          {r.session_id === session?.session_id ? <span className="text-allow">this session</span> : shortHash(r.session_id, 12)}
                        </td>
                        <td className="ig-mono py-1.5 text-ibm-2" title={r.hash}>
                          {shortHash(r.hash, 12)}
                        </td>
                        <td className="ig-mono py-1.5 text-muted" title={r.prev_hash}>
                          {shortHash(r.prev_hash, 12)}
                        </td>
                        <td className="py-1.5 text-right">
                          {linked === true ? (
                            <span className="inline-flex items-center gap-1 text-[10.5px] text-allow" title={`prev_hash equals hash of #${r.seq - 1}`}>
                              <Link2 size={12} /> #{r.seq - 1}
                            </span>
                          ) : linked === false ? (
                            <span className="text-[10.5px] text-block">mismatch</span>
                          ) : (
                            <span className="text-[10.5px] text-dim" title="Previous record not in this listing (other session or beyond the row limit)">
                              ·
                            </span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-white/[0.02]">
                          <td />
                          <td colSpan={8} className="pb-3">
                            <div className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1 py-1.5 text-[11px]">
                              <span className="text-muted">hash</span>
                              <span className="ig-mono break-all text-fg-2">{r.hash}</span>
                              <span className="text-muted">prev_hash</span>
                              <span className="ig-mono break-all text-fg-2">{r.prev_hash}</span>
                            </div>
                            <pre className="ig-mono max-h-72 overflow-auto rounded-[4px] border border-line bg-black/30 px-3 py-2 text-[10.5px] leading-relaxed text-fg-2">
                              {JSON.stringify(r.payload, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          {rows && shown.length === 0 && <div className="py-6 text-center text-[12px] text-muted">No records match.</div>}
        </div>
      </div>
    </div>
  );
}
