import type { ReactNode } from "react";
import { ArrowRight, Cpu } from "lucide-react";
import type { Decision, Finding, JsonValue } from "../../api/types";
import { VERDICT_COLOR } from "../../lib/constants";
import { money, ms, num, opLabel, shortHash } from "../../lib/format";
import type { Names } from "../../lib/names";
import { useStore } from "../../store/store";
import { cx, HashText, OutcomeIcon, TrustBadge, VerdictChip } from "../ui/ui";

export function Block({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("border-b border-line px-4 py-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="ig-label">{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

function Row({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2 py-[3px]">
      <span className="text-[11px] text-muted">{k}</span>
      <span className={cx("min-w-0 text-[12px] break-words text-fg", mono && "ig-mono text-[11.5px]")}>{children}</span>
    </div>
  );
}

function str(v: JsonValue | undefined): string | null {
  return typeof v === "string" ? v : null;
}

function numv(v: JsonValue | undefined): number | null {
  return typeof v === "number" ? v : null;
}

function findEvidence(d: Decision, code: string, key: string): JsonValue | undefined {
  return d.findings.find((f) => f.code === code && f.evidence[key] !== undefined)?.evidence[key];
}

export function ActionDetails({ d, names }: { d: Decision; names: Names }) {
  const a = d.action;
  const p = a.parameters;
  const rows: { k: string; v: ReactNode; mono?: boolean }[] = [];
  const idName = (name: string, id: string | null) => (
    <span>
      {name}
      {id && name !== id && <span className="ig-mono ml-1.5 text-[10.5px] text-dim">{id}</span>}
    </span>
  );
  switch (a.action_type) {
    case "reroute_ambulance":
    case "dispatch_ambulance": {
      const amb = typeof p.ambulance_id === "string" ? p.ambulance_id : null;
      const dest = typeof p.destination_hospital_id === "string" ? p.destination_hospital_id : null;
      const inc = typeof p.incident_id === "string" ? p.incident_id : null;
      rows.push({ k: "Unit", v: idName(names.ambulance(amb), amb) });
      rows.push({ k: "Destination", v: idName(names.hospital(dest), dest) });
      if (inc) rows.push({ k: "Incident", v: inc, mono: true });
      const route = Array.isArray(p.route) ? p.route : null;
      const eta = numv(findEvidence(d, "IG-OPS-005", "eta_min"));
      if (route?.length)
        rows.push({
          k: "Route",
          v: (
            <span className="ig-mono text-[11px]">
              {route.length} nodes · {route[0]} <ArrowRight size={10} className="inline" /> {route[route.length - 1]}
              {eta !== null && <span className="text-muted"> · ETA {eta.toFixed(1)} min</span>}
            </span>
          ),
        });
      else rows.push({ k: "Route", v: <span className="text-muted">planned by the gateway at execution</span> });
      break;
    }
    case "purchase_supplies": {
      const q = numv(p.quantity);
      const u = numv(p.unit_price_usd);
      const t = numv(p.total_usd);
      rows.push({ k: "Supplier", v: idName(names.supplier(str(p.supplier_id)), str(p.supplier_id)) });
      rows.push({ k: "Item", v: idName(names.sku(str(p.item_sku)), str(p.item_sku)) });
      rows.push({
        k: "Order",
        v: (
          <span className="ig-num">
            {num(q)} × {money(u, true)} = <span className="font-semibold text-fg">{money(t)}</span>
          </span>
        ),
      });
      rows.push({ k: "Deliver to", v: idName(names.hospital(str(p.delivery_hospital_id)), str(p.delivery_hospital_id)) });
      break;
    }
    case "reserve_icu_beds":
      rows.push({ k: "Hospital", v: idName(names.hospital(str(p.hospital_id)), str(p.hospital_id)) });
      rows.push({ k: "ICU beds", v: <span className="ig-num font-semibold">{num(numv(p.beds))}</span> });
      if (numv(p.duration_hours) !== null) rows.push({ k: "Duration", v: `${numv(p.duration_hours)} h` });
      break;
    case "update_hospital_status":
      rows.push({ k: "Hospital", v: idName(names.hospital(str(p.hospital_id)), str(p.hospital_id)) });
      rows.push({ k: "New status", v: <span className="font-semibold uppercase tracking-[0.06em]">{str(p.status)}</span> });
      break;
    case "share_patient_record":
      rows.push({ k: "Record", v: idName(names.record(str(p.record_id)), str(p.record_id)) });
      rows.push({ k: "Recipient", v: str(p.recipient) ?? "n/a" });
      if (str(p.purpose)) rows.push({ k: "Purpose", v: str(p.purpose) });
      break;
    case "cancel_dispatch":
      rows.push({ k: "Unit", v: idName(names.ambulance(str(p.ambulance_id)), str(p.ambulance_id)) });
      if (str(p.reason)) rows.push({ k: "Reason", v: str(p.reason) });
      break;
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-fg">{opLabel(a.action_type)}</span>
        <span className="ig-mono rounded-[3px] border border-line px-1.5 text-[10.5px] leading-[18px] text-fg-2">{a.tool}</span>
      </div>
      <Row k="Target">{idName(names.entity(a.target), a.target)}</Row>
      {rows.map((r) => (
        <Row key={r.k} k={r.k} mono={r.mono}>
          {r.v}
        </Row>
      ))}
      {a.rationale && (
        <div className="mt-2 rounded-[3px] bg-white/[0.025] px-2 py-1.5 text-[11px] leading-snug text-fg-2">
          <span className="ig-label-sm mr-1.5">Agent rationale</span>
          {a.rationale}
        </div>
      )}
    </div>
  );
}

export function TrustBlock({ d, names }: { d: Decision; names: Names }) {
  const tb = d.trust_boundary;
  const untrusted = d.action.provenance.filter((p) => p.trust === "untrusted");
  if (!tb && !untrusted.length) return null;
  const crossed = tb?.crossed ?? false;
  return (
    <Block
      title="Trust boundary"
      right={
        <span className={cx("text-[10.5px] font-semibold tracking-[0.1em]", crossed ? "text-block" : "text-allow")}>{crossed ? "CROSSED" : "NOT CROSSED"}</span>
      }
    >
      <div className={cx("rounded-[4px] border p-2.5", crossed ? "border-block/40 bg-block/[0.05]" : "border-line")}>
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          {(tb?.untrusted_sources ?? untrusted.map((u) => u.source_id)).map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <TrustBadge trust="untrusted" />
              <span className="ig-mono text-[11px] text-fg" title={names.feed(s)}>
                {s}
              </span>
            </span>
          ))}
          <ArrowRight size={12} className="text-muted" />
          {(tb?.influenced_fields ?? untrusted.flatMap((u) => u.influenced_fields)).map((f) => (
            <span key={f} className="ig-mono rounded-[2px] bg-white/[0.05] px-1 text-[11px] text-fg">
              {f}
            </span>
          ))}
        </div>
        {tb?.description && <p className="mt-2 text-[11px] leading-snug text-fg-2">{tb.description}</p>}
      </div>
    </Block>
  );
}

export function ProvenanceList({ d, names }: { d: Decision; names: Names }) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      {d.action.provenance.map((p, i) => (
        <div key={`${p.source_id}-${i}`} className="flex items-start gap-2 text-[11px]">
          <TrustBadge trust={p.trust} />
          <div className="min-w-0 flex-1">
            <span className="ig-mono text-fg-2">{p.source_id}</span>
            <span className="text-muted"> · {p.source_type.replace(/_/g, " ")}</span>
            {p.source_type === "operator" && <span className="text-muted"> ({names.operator(p.source_id)})</span>}
            <span className="block text-[10.5px] text-dim">sets {p.influenced_fields.join(", ") || "nothing"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RiskBlock({ d }: { d: Decision }) {
  const health = useStore((s) => s.health);
  const r = d.risk;
  const mlFinding = d.findings.find((f) => f.code === "IG-ML-000");
  const fusion = (
    <div className="mt-2.5 border-t border-line pt-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] whitespace-nowrap text-muted">
        <span>Hard policy</span>
        <VerdictChip verdict={d.hard_verdict} size="xs" />
        <span>+ ML</span>
        {r ? <VerdictChip verdict={r.ml_verdict} size="xs" /> : <span className="text-dim">n/a</span>}
        <ArrowRight size={11} />
        <span>final</span>
        <VerdictChip verdict={d.verdict} size="xs" />
      </div>
      <div className="mt-1 text-[10px] text-dim">Fusion takes the stricter verdict: the model can escalate, never relax.</div>
    </div>
  );
  if (!r) {
    const reason = typeof mlFinding?.evidence.error === "string" ? mlFinding.evidence.error : health?.model.runtime ?? "no model loaded";
    return (
      <Block title="ML risk estimate" right={<span className="text-[10.5px] font-medium text-challenge">MODEL NOT LOADED</span>}>
        <div className="rounded-[4px] border border-challenge/30 bg-challenge/[0.05] p-2.5">
          <div className="flex items-center gap-2 text-[12px] font-medium text-challenge">
            <Cpu size={13} /> Risk model not loaded on this gateway
          </div>
          <p className="mt-1 text-[11px] leading-snug text-fg-2">
            This decision used hard policy only. Server reason: <span className="ig-mono text-[10.5px]">{reason}</span>
          </p>
        </div>
        {fusion}
      </Block>
    );
  }
  const seg = [
    { k: "ALLOW", v: r.p_allow, c: VERDICT_COLOR.ALLOW },
    { k: "CHALLENGE", v: r.p_challenge, c: VERDICT_COLOR.CHALLENGE },
    { k: "BLOCK", v: r.p_block, c: VERDICT_COLOR.BLOCK },
  ];
  const maxW = Math.max(1e-6, ...r.top_factors.map((f) => f.weight));
  return (
    <Block title="ML risk estimate" right={<VerdictChip verdict={r.ml_verdict} size="xs" />}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="ig-label-sm">Risk score</div>
          <div className="ig-mono text-[22px] leading-tight font-medium text-fg">{r.risk_score.toFixed(3)}</div>
        </div>
        <div className="min-w-0 text-right text-[10.5px] text-muted">
          <div className="truncate text-fg-2" title={r.runtime}>
            {r.runtime}
          </div>
          <div className="ig-mono">model {r.model_version}</div>
        </div>
      </div>
      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-white/[0.04]">
        {seg.map((s) => (
          <div key={s.k} style={{ width: `${Math.max(0, s.v) * 100}%`, background: s.c }} title={`P(${s.k}) = ${s.v.toFixed(4)}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px]">
        {seg.map((s) => (
          <span key={s.k} className="ig-mono" style={{ color: s.c }}>
            {s.k.slice(0, 1)}
            {s.k.slice(1).toLowerCase()} {s.v.toFixed(3)}
          </span>
        ))}
      </div>
      {Object.keys(r.thresholds).length > 0 && (
        <div className="ig-mono mt-1 text-[10px] text-dim">
          {Object.entries(r.thresholds)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ")}
        </div>
      )}
      {r.top_factors.length > 0 && (
        <div className="mt-2.5">
          <div className="ig-label-sm mb-1">Top factors (importance × deviation)</div>
          {r.top_factors.map((f) => (
            <div key={f.feature} className="grid grid-cols-[1fr_56px_70px] items-center gap-2 py-[2px] text-[11px]">
              <span className="ig-mono truncate text-fg-2" title={f.feature}>
                {f.feature}
              </span>
              <span className="ig-mono text-right text-muted">{f.value}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                <span className="block h-full bg-ibm-2" style={{ width: `${(f.weight / maxW) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}
      {fusion}
    </Block>
  );
}

const OUTCOME_RANK: Record<Finding["outcome"], number> = { block: 0, challenge: 1, info: 2, pass: 3 };

export function PolicyChecks({ d }: { d: Decision }) {
  const blocks = d.findings.filter((f) => f.outcome === "block").length;
  const chals = d.findings.filter((f) => f.outcome === "challenge").length;
  const sorted = [...d.findings].sort((a, b) => OUTCOME_RANK[a.outcome] - OUTCOME_RANK[b.outcome]);
  return (
    <Block
      title="Policy checks"
      right={
        <span className="ig-mono text-[10.5px] text-muted">
          {d.findings.length} checks
          {blocks > 0 && <span className="text-block"> · {blocks} block</span>}
          {chals > 0 && <span className="text-challenge"> · {chals} review</span>}
        </span>
      }
    >
      <div className="flex flex-col">
        {sorted.map((f, i) => (
          <div
            key={`${f.code}-${i}`}
            className={cx("grid grid-cols-[16px_1fr] gap-2 rounded-[3px] px-1 py-[5px]", f.outcome === "block" && "bg-block/[0.05]", f.outcome === "challenge" && "bg-challenge/[0.05]")}
          >
            <span className="pt-[2px]">
              <OutcomeIcon outcome={f.outcome} />
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline gap-2">
                <span className="ig-mono shrink-0 text-[10.5px] text-muted">{f.code}</span>
                <span className="truncate text-[11.5px] font-medium text-fg">{f.check}</span>
              </span>
              <span className={cx("block text-[11px] leading-snug", f.outcome === "pass" ? "text-muted" : "text-fg-2")}>{f.message}</span>
            </span>
          </div>
        ))}
      </div>
    </Block>
  );
}

export function LatencyBlock({ d }: { d: Decision }) {
  const l = d.latency_ms;
  const total = Math.max(1e-6, l.decision_ms ?? 0, l.end_to_end_ms ?? 0);
  const rows: { k: string; v: number | undefined; c: string }[] = [
    { k: "Policy", v: l.policy_ms, c: "#4589FF" },
    { k: "Features", v: l.features_ms, c: "#7FB0FF" },
    { k: "ML inference", v: l.inference_ms, c: "#00D5B5" },
  ];
  return (
    <Block
      title="Latency"
      right={
        <span className="ig-mono text-[11px] text-fg">
          decision {ms(l.decision_ms)}
          {l.end_to_end_ms !== undefined && <span className="text-muted"> · e2e {ms(l.end_to_end_ms)}</span>}
        </span>
      }
    >
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.k} className="grid grid-cols-[86px_1fr_70px] items-center gap-2 text-[11px]">
            <span className="text-muted">{r.k}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
              <span className="block h-full rounded-full" style={{ width: `${Math.min(100, ((r.v ?? 0) / total) * 100)}%`, background: r.c }} />
            </span>
            <span className="ig-mono text-right text-fg-2">{ms(r.v)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[10px] text-dim">Measured server-side by the gateway for this decision.</div>
    </Block>
  );
}

export function AuditRefs({ d }: { d: Decision }) {
  const refs = [
    { k: "Proposed", r: d.audit.proposed },
    { k: "Decision", r: d.audit.decision },
    { k: "Outcome", r: d.audit.outcome },
  ];
  return (
    <Block title="Audit chain" right={<span className="text-[10px] text-dim">SHA-256 hash-chained</span>}>
      <div className="flex flex-col gap-0.5">
        {refs.map(({ k, r }) =>
          r ? (
            <div key={k} className="grid grid-cols-[64px_44px_1fr] items-center gap-2 text-[11px]">
              <span className="text-muted">{k}</span>
              <span className="ig-mono text-fg-2">#{r.seq}</span>
              <span className="flex min-w-0 items-center justify-between gap-1">
                <span className="ig-mono truncate text-[10.5px] text-muted" title={r.event_type}>
                  {r.event_type}
                </span>
                <HashText value={r.hash} n={10} />
              </span>
            </div>
          ) : null,
        )}
      </div>
      <div className="ig-mono mt-1.5 text-[10px] text-dim" title={d.fingerprint}>
        action fingerprint {shortHash(d.fingerprint, 16)}
      </div>
    </Block>
  );
}

