import { useEffect, useMemo, useRef } from "react";
import { ScrollText } from "lucide-react";
import type { DecisionSummary } from "../../api/types";
import { VERDICT_COLOR } from "../../lib/constants";
import { clockTime, ms, opLabel, shortHash } from "../../lib/format";
import { useNames } from "../../lib/names";
import { currentDecisionId, selectDecision, setState, useStore } from "../../store/store";
import { cx, VerdictGlyph } from "../ui/ui";

const AGENT_SHORT: Record<string, string> = {
  "route-planner-01": "Routing",
  "supply-agent-02": "Procurement",
  "capacity-agent-03": "Coordination",
};

function Chip({ s, selected }: { s: DecisionSummary; selected: boolean }) {
  const c = VERDICT_COLOR[s.verdict];
  const names = useNames();
  return (
    <button
      type="button"
      onClick={() => selectDecision(s.decision_id)}
      className={cx("group relative flex h-[66px] w-[176px] shrink-0 flex-col justify-between rounded-[4px] border px-2.5 py-1.5 text-left transition-colors")}
      style={{
        borderColor: selected ? c : "rgba(132,150,168,0.16)",
        background: selected ? `${c}14` : "rgba(255,255,255,0.015)",
        boxShadow: selected ? `0 0 0 1px ${c}55, 0 0 18px ${c}22` : undefined,
      }}
      title={s.explanation}
    >
      <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full" style={{ background: c }} />
      <span className="flex items-center justify-between gap-1.5">
        <span className="flex items-center gap-1 text-[10.5px] font-semibold tracking-[0.1em]" style={{ color: c }}>
          <VerdictGlyph verdict={s.verdict} size={9} />
          {s.verdict}
        </span>
        <span className="ig-mono text-[10px] text-dim">{clockTime(s.timestamp)}</span>
      </span>
      <span className="truncate text-[11.5px] leading-tight text-fg">{opLabel(s.action_type)}</span>
      <span className="flex items-center justify-between gap-1.5 text-[10px] text-muted">
        <span className="truncate">
          {AGENT_SHORT[s.agent_id] ?? s.agent_id} · {names.entity(s.target)}
        </span>
        <span className="ig-mono shrink-0 text-fg-2">{ms(s.decision_ms)}</span>
      </span>
    </button>
  );
}

export function BottomStrip() {
  const decisions = useStore((s) => s.decisions);
  const selected = useStore(currentDecisionId);
  const audit = useStore((s) => s.recentAudit);
  const chrono = useMemo(() => [...decisions].sort((a, b) => a.timestamp - b.timestamp), [decisions]);
  const scroller = useRef<HTMLDivElement>(null);
  const count = chrono.length;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [count]);

  return (
    <div className="flex h-[120px] shrink-0 border-t border-line bg-[linear-gradient(180deg,rgba(9,20,32,0.96),rgba(6,13,21,0.98))]">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-7 items-center justify-between px-3">
          <span className="ig-label">Decision timeline</span>
          <span className="ig-mono text-[10px] text-dim">
            {count} decision{count === 1 ? "" : "s"} · this sandbox
          </span>
        </div>
        <div ref={scroller} className="flex min-h-0 flex-1 items-start gap-1.5 overflow-x-auto overflow-y-hidden px-3 pb-2">
          {count === 0 ? (
            <div className="flex h-[66px] items-center text-[11.5px] text-dim">Verdicts appear here in real time as agents propose actions.</div>
          ) : (
            chrono.map((s) => <Chip key={s.decision_id} s={s} selected={s.decision_id === selected} />)
          )}
        </div>
      </div>
      <div className="flex w-[380px] shrink-0 flex-col border-l border-line">
        <div className="flex h-7 items-center justify-between px-3">
          <span className="ig-label">Audit events</span>
          <button type="button" className="flex items-center gap-1 text-[10.5px] text-muted hover:text-fg" onClick={() => setState({ view: "audit" })}>
            <ScrollText size={11} /> Open audit
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {audit.slice(0, 12).map((r) => (
            <div key={r.seq} className="grid grid-cols-[40px_1fr_auto] items-center gap-2 py-[2px] text-[10.5px]">
              <span className="ig-mono text-fg-2">#{r.seq}</span>
              <span className="truncate text-fg-2">{r.event_type}</span>
              <span className="ig-mono text-dim" title={r.hash}>
                {shortHash(r.hash, 8)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
