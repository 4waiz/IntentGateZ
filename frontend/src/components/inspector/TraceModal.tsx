import { useEffect, useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { api, ApiError } from "../../api/client";
import type { AuditRecord, JsonValue, TraceResponse, TraceStep } from "../../api/types";
import { ms, shortHash } from "../../lib/format";
import { cx, HashText, Modal, Spinner, VerdictChip } from "../ui/ui";

const STEP_LABEL: Record<string, string> = {
  "proposal.received": "Proposal received",
  "audit.append": "Audit record appended",
  "intent.loaded": "Human intent loaded & signature checked",
  "policy.evaluated": "Hard policy evaluated",
  "features.extracted": "Contextual features extracted",
  "ml.inference": "ML risk inference",
  "decision.fused": "Verdict fused",
  "simulation.executed": "Executed in simulation",
  "simulation.prevented": "Prevented: simulation unchanged",
  "simulation.failed": "Execution failed safely",
  "challenge.opened": "Challenge opened for supervisor",
};

function stepColor(s: TraceStep): string {
  if (s.step === "decision.fused") {
    const v = s.verdict;
    return v === "BLOCK" ? "#FF5D70" : v === "CHALLENGE" ? "#FFBC5C" : "#00D5B5";
  }
  if (s.step === "simulation.prevented" || s.step === "simulation.failed") return "#FF5D70";
  if (s.step === "challenge.opened") return "#FFBC5C";
  if (s.step === "simulation.executed") return "#00D5B5";
  if (s.step === "audit.append") return "#4589FF";
  return "#8496A8";
}

function fmtVal(v: JsonValue | undefined): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "string") return v.length > 70 ? `${v.slice(0, 64)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 70 ? `${s.slice(0, 64)}…` : s;
}

function StepRow({ s, prev }: { s: TraceStep; prev: number }) {
  const c = stepColor(s);
  const details = Object.entries(s).filter(([k]) => k !== "step" && k !== "t_ms");
  return (
    <div className="relative grid grid-cols-[78px_18px_1fr] gap-2">
      <div className="ig-mono pt-[1px] text-right text-[11px] text-fg-2">
        {s.t_ms.toFixed(3)}
        <div className="text-[9.5px] text-dim">+{(s.t_ms - prev).toFixed(3)}</div>
      </div>
      <div className="relative flex justify-center">
        <span className="absolute top-0 bottom-0 w-px bg-line" />
        <span className="relative mt-[3px] h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: c, background: "#050B12", boxShadow: `0 0 8px ${c}66` }} />
      </div>
      <div className="pb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-fg">{STEP_LABEL[s.step] ?? s.step}</span>
          <span className="ig-mono text-[10px] text-dim">{s.step}</span>
        </div>
        {details.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {details.map(([k, v]) => (
              <span key={k} className="ig-mono text-[10.5px] text-muted">
                {k}=<span className={cx(k === "hash" ? "text-ibm-2" : "text-fg-2")}>{k === "hash" && typeof v === "string" ? shortHash(v, 14) : fmtVal(v)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AuditRow({ r, prev }: { r: AuditRecord; prev: AuditRecord | null }) {
  const [open, setOpen] = useState(false);
  const consecutive = prev !== null && prev.seq === r.seq - 1;
  const linked = consecutive && prev?.hash === r.prev_hash;
  return (
    <div className="rounded-[4px] border border-line bg-white/[0.015]">
      <button type="button" className="grid w-full grid-cols-[52px_1fr_auto] items-center gap-3 px-3 py-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="ig-mono text-[12px] text-fg">#{r.seq}</span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] text-fg">{r.event_type}</span>
          <span className="ig-mono block truncate text-[10.5px] text-muted">
            {r.time} · {r.subject_id}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[10.5px]">
          {prev === null ? null : linked ? (
            <span className="flex items-center gap-1 text-allow" title="prev_hash equals the previous record's hash">
              <Link2 size={12} /> linked to #{prev.seq}
            </span>
          ) : consecutive ? (
            <span className="flex items-center gap-1 text-block">
              <Link2Off size={12} /> broken link
            </span>
          ) : (
            <span className="text-dim" title="Other sessions' records sit between these in the global chain">
              {r.seq - (prev?.seq ?? r.seq) - 1} records between
            </span>
          )}
        </span>
      </button>
      <div className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-0.5 border-t border-line px-3 py-1.5">
        <span className="ig-label-sm pt-[2px]">prev_hash</span>
        <HashText value={r.prev_hash} n={32} />
        <span className="ig-label-sm pt-[2px]">hash</span>
        <HashText value={r.hash} n={32} />
      </div>
      {open && <pre className="ig-mono max-h-56 overflow-auto border-t border-line bg-black/30 px-3 py-2 text-[10.5px] leading-relaxed text-fg-2">{JSON.stringify(r.payload, null, 2)}</pre>}
    </div>
  );
}

export default function TraceModal({ decisionId, onClose }: { decisionId: string; onClose: () => void }) {
  const [data, setData] = useState<TraceResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(null);
    api
      .trace(decisionId)
      .then((t) => alive && setData(t))
      .catch((e: unknown) => alive && setErr(e instanceof ApiError ? `${e.status} ${e.code}: ${e.message}` : String(e)));
    return () => {
      alive = false;
    };
  }, [decisionId]);

  return (
    <Modal
      open
      onClose={onClose}
      width={1040}
      title={
        <span className="flex items-center gap-3">
          Decision trace
          {data && <VerdictChip verdict={data.verdict} size="sm" />}
          <span className="ig-mono text-[11px] font-normal text-muted">{decisionId}</span>
        </span>
      }
      subtitle="Every step the gateway took for this proposal, then the tamper-evident audit records it wrote (SHA-256 chain)."
    >
      {!data && !err && (
        <div className="flex items-center gap-2 p-6 text-[12px] text-muted">
          <Spinner size={13} /> Loading trace from the gateway…
        </div>
      )}
      {err && <div className="p-6 text-[12px] text-block">{err}</div>}
      {data && (
        <div className="grid grid-cols-1 gap-0 md:grid-cols-[1fr_1.1fr]">
          <div className="border-r border-line p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="ig-label">Pipeline timeline</span>
              <span className="ig-mono text-[11px] text-fg-2">
                decision {ms(data.latency_ms.decision_ms)} · e2e {ms(data.latency_ms.end_to_end_ms)}
              </span>
            </div>
            <div className="mb-2 grid grid-cols-[78px_18px_1fr] gap-2 text-[9.5px] tracking-[0.12em] text-dim uppercase">
              <span className="text-right">t (ms)</span>
              <span />
              <span>step</span>
            </div>
            {data.trace.map((s, i) => (
              <StepRow key={`${s.step}-${i}`} s={s} prev={i > 0 ? data.trace[i - 1].t_ms : 0} />
            ))}
          </div>
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="ig-label">Linked audit records</span>
              <span className="ig-mono text-[10.5px] text-muted">
                chain head #{data.chain.seq} {shortHash(data.chain.hash, 12)}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {data.audit_records.map((r, i) => (
                <AuditRow key={r.seq} r={r} prev={i > 0 ? data.audit_records[i - 1] : null} />
              ))}
            </div>
            <p className="mt-3 text-[10.5px] leading-snug text-dim">
              Each record commits to the previous record's hash, so editing, deleting or reordering any stored event breaks verification from that point on. Verify the whole
              chain from the Audit view.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
