import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useStore } from "../../store/store";
import { cx } from "../ui/ui";
import { DispatchQueue, FeedList, IntentsList, UnitsList } from "./Lists";
import { ScenarioLauncher } from "./ScenarioLauncher";

function Section({ title, count, children, defaultOpen = true, accent }: { title: string; count?: number; children: ReactNode; defaultOpen?: boolean; accent?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-white/[0.015]">
        <span className="flex items-center gap-2">
          {accent && <span className="h-3 w-[2px] rounded-full" style={{ background: accent }} />}
          <span className="ig-label">{title}</span>
          {count !== undefined && <span className="ig-mono text-[10px] text-dim">{count}</span>}
        </span>
        <ChevronDown size={13} className={cx("text-dim transition-transform", !open && "-rotate-90")} />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

export function CommandPanel() {
  const nInc = useStore((s) => s.sim?.incidents.length ?? 0);
  const nUnits = useStore((s) => s.sim?.ambulances.length ?? 0);
  const nIntents = useStore((s) => s.sim?.intents.length ?? 0);
  const nFeeds = useStore((s) => s.sim?.feeds.length ?? 0);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Scenarios" accent="#0F62FE">
          <ScenarioLauncher />
        </Section>
        <Section title="Live dispatch queue" count={nInc}>
          <DispatchQueue />
        </Section>
        <Section title="Units" count={nUnits}>
          <UnitsList />
        </Section>
        <Section title="Operator intents" count={nIntents} accent="#00D5B5">
          <IntentsList />
        </Section>
        <Section title="External feed" count={nFeeds} accent="#FF5D70">
          <FeedList />
        </Section>
      </div>
    </div>
  );
}
