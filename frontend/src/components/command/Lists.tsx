import { useMemo } from "react";
import { Crosshair, Navigation, ShieldAlert } from "lucide-react";
import type { Ambulance, FeedItem, HumanIntent, Incident } from "../../api/types";
import { COLORS } from "../../lib/constants";
import { clockTime, countdown, money, opLabel, shortHash } from "../../lib/format";
import { useNames } from "../../lib/names";
import { commandCamera, setState, useStore } from "../../store/store";
import { cx, Empty, TrustBadge, useServerNow } from "../ui/ui";

// ------------------------------------------------------------------ dispatch queue

const SEV_COLOR = (sev: number) => (sev >= 5 ? "#FF7A45" : sev === 4 ? "#FF9F43" : "#FFC861");

export function DispatchQueue() {
  const incidents = useStore((s) => s.sim?.incidents);
  const names = useNames();
  const sorted = useMemo(() => [...(incidents ?? [])].sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id)), [incidents]);
  if (!sorted.length) return <Empty>No incidents in the dispatch queue.</Empty>;
  return (
    <div className="flex flex-col gap-1">
      {sorted.map((inc: Incident) => (
        <button
          key={inc.id}
          type="button"
          onClick={() => commandCamera("incident", inc.id)}
          className="group flex items-stretch gap-2 rounded-[4px] border border-transparent px-1.5 py-1.5 text-left hover:border-line hover:bg-white/[0.02]"
        >
          <span className="w-[3px] shrink-0 rounded-full" style={{ background: SEV_COLOR(inc.severity), boxShadow: `0 0 6px ${SEV_COLOR(inc.severity)}66` }} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="ig-mono text-[11px] text-fg">{inc.id}</span>
              <span className="ig-label-sm" style={{ color: inc.status === "open" ? COLORS.incident : COLORS.muted }}>
                {inc.status}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-[11.5px] text-fg-2">{inc.description}</span>
            <span className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted">
              <span>SEV {inc.severity}</span>
              <span>· {inc.required_specialty}</span>
              {inc.assigned_ambulance && <span>· {names.ambulance(inc.assigned_ambulance)}</span>}
            </span>
          </span>
          <Crosshair size={12} className="mt-0.5 shrink-0 text-dim opacity-0 group-hover:opacity-100" />
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ units

const UNIT_STATUS: Record<string, { label: string; c: string }> = {
  available: { label: "Available", c: "#8496A8" },
  dispatched: { label: "Dispatched", c: "#4589FF" },
  transporting: { label: "Transporting", c: "#00D5B5" },
  at_hospital: { label: "At hospital", c: "#C3D0DC" },
  returning: { label: "Returning", c: "#8496A8" },
};

export function UnitsList() {
  const ambulances = useStore((s) => s.sim?.ambulances);
  const followId = useStore((s) => s.followId);
  const cameraMode = useStore((s) => s.cameraMode);
  const names = useNames();
  if (!ambulances?.length) return <Empty>No units reported.</Empty>;
  return (
    <div className="flex flex-col gap-0.5">
      {ambulances.map((a: Ambulance) => {
        const st = UNIT_STATUS[a.status] ?? { label: a.status, c: COLORS.muted };
        const following = cameraMode === "follow" && followId === a.id;
        return (
          <div
            key={a.id}
            className="group flex items-center gap-2 rounded-[4px] px-1.5 py-1 hover:bg-white/[0.025]"
            onMouseEnter={() => setState({ hovered: { type: "ambulance", id: a.id } })}
            onMouseLeave={() => setState({ hovered: null })}
          >
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => commandCamera("ambulance", a.id)} title="Focus camera">
              <span className="ig-mono w-[58px] shrink-0 text-[11px] font-medium text-fg">{a.call_sign}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 text-[11px]" style={{ color: st.c }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.c }} />
                  {st.label}
                  {a.ambient && (
                    <span className="text-[9.5px] tracking-[0.08em] text-dim uppercase" title="Ambient movement of a unit no agent controls">
                      · ambient
                    </span>
                  )}
                </span>
                <span className="truncate text-[10.5px] text-muted">
                  {a.destination_hospital_id ? `→ ${names.hospital(a.destination_hospital_id)}` : a.patient ? a.patient : `at ${a.node}`}
                </span>
              </span>
            </button>
            <button
              type="button"
              title={following ? "Following" : "Follow vehicle"}
              className={cx("flex h-5 w-5 items-center justify-center rounded-[3px]", following ? "text-allow" : "text-dim opacity-0 group-hover:opacity-100 hover:text-fg")}
              onClick={() => commandCamera("follow", a.id)}
            >
              <Navigation size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ operator intents

function IntentCard({ intent, now }: { intent: HumanIntent; now: number }) {
  const names = useNames();
  const left = intent.expires_at - now;
  const limits: string[] = [];
  if (intent.financial) limits.push(`budget ${money(intent.financial.budget_usd)} · ceiling ${money(intent.financial.escalation_ceiling_usd)}`);
  if (intent.resource_limits.max_icu_beds !== null) limits.push(`max ${intent.resource_limits.max_icu_beds} ICU beds`);
  if (intent.routing.max_eta_min !== null) limits.push(`ETA ≤ ${intent.routing.max_eta_min} min`);
  const t = intent.permitted_targets;
  const targets = [...t.ambulances.map(names.ambulance), ...t.hospitals.map(names.hospital), ...t.suppliers.map(names.supplier), ...t.incidents];
  return (
    <div className="ig-card p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium text-fg">
          {names.operator(intent.operator_id)} <span className="font-normal text-muted">· {names.role(intent.operator_role)}</span>
        </span>
        <span className="ig-mono text-[10px] text-muted">v{intent.version}</span>
      </div>
      <p className="mt-1 line-clamp-3 border-l border-allow/40 pl-2 text-[11px] leading-snug text-fg-2 italic">“{intent.instruction}”</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {intent.authorized_operations.map((op) => (
          <span key={op} className="rounded-[2px] border border-allow/30 bg-allow/[0.06] px-1 text-[9.5px] leading-[15px] font-medium text-allow">
            {opLabel(op)}
          </span>
        ))}
      </div>
      {targets.length > 0 && <div className="mt-1 truncate text-[10.5px] text-muted" title={targets.join(", ")}>Scope: {targets.join(", ")}</div>}
      {limits.length > 0 && <div className="mt-0.5 text-[10.5px] text-muted">Limits: {limits.join(" · ")}</div>}
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-line pt-1.5 text-[10px]">
        <span className="ig-mono text-dim" title={`HMAC signature ${intent.signature}`}>
          sig {shortHash(intent.signature, 10)}
        </span>
        <span className={cx("ig-mono", left > 0 ? "text-muted" : "text-block")}>{left > 0 ? `expires ${countdown(left)}` : "expired"}</span>
      </div>
    </div>
  );
}

export function IntentsList() {
  const intents = useStore((s) => s.sim?.intents);
  const now = useServerNow(1000);
  const sorted = useMemo(() => [...(intents ?? [])].sort((a, b) => b.created_at - a.created_at), [intents]);
  if (!sorted.length) return <Empty>No intents registered yet. Run a scenario or register one in Studio; every agent action must cite a signed human intent.</Empty>;
  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((i) => (
        <IntentCard key={`${i.intent_id}:${i.version}`} intent={i} now={now} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ external feed

export function FeedList() {
  const feeds = useStore((s) => s.sim?.feeds);
  const cache = useStore((s) => s.decisionCache);
  const cited = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of Object.values(cache)) {
      if (d.verdict !== "BLOCK") continue;
      for (const src of d.trust_boundary?.untrusted_sources ?? []) m.set(src, d.decision_id);
      for (const p of d.action.provenance) if (p.trust === "untrusted") m.set(p.source_id, d.decision_id);
    }
    return m;
  }, [cache]);
  const sorted = useMemo(() => [...(feeds ?? [])].sort((a, b) => b.ts - a.ts), [feeds]);
  if (!sorted.length) return <Empty>No external feed messages.</Empty>;
  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((f: FeedItem) => {
        const blockedBy = cited.get(f.id);
        const flagged = Boolean(blockedBy);
        return (
          <div
            key={f.id}
            className={cx("rounded-[4px] border p-2 transition-colors", flagged ? "border-block/70 bg-block/[0.05] shadow-[0_0_0_1px_rgba(255,93,112,0.15)]" : "border-line bg-white/[0.012]")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10.5px] text-muted" title={f.source}>
                {f.source}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="ig-mono text-[10px] text-dim">{clockTime(f.ts)}</span>
                <TrustBadge trust={f.trust} />
              </span>
            </div>
            <p className={cx("mt-1 text-[11px] leading-snug", flagged ? "text-fg" : "text-fg-2")}>{f.text}</p>
            {flagged && (
              <div className="mt-1.5 flex items-start gap-1.5 text-[10.5px] text-block">
                <ShieldAlert size={12} className="mt-px shrink-0" />
                <span>
                  <span className="font-medium">Cited by a BLOCK</span>: agent-directed instructions found in untrusted data.
                  <span className="ig-mono ml-1 text-block/75">{blockedBy}</span>
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
