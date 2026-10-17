import { Play, ShieldCheck } from "lucide-react";
import type { Scenario, Verdict } from "../../api/types";
import { runScenario } from "../../store/actions";
import { useStore } from "../../store/store";
import { cx, Spinner, VerdictChip } from "../ui/ui";

function expectedVerdicts(expected: string): Verdict[] {
  return expected
    .split(/[^A-Z]+/)
    .filter((w): w is Verdict => w === "ALLOW" || w === "CHALLENGE" || w === "BLOCK");
}

function ScenarioCard({ sc }: { sc: Scenario }) {
  const busy = useStore((s) => s.busy[`scenario:${sc.id}`] ?? false);
  const anyBusy = useStore((s) => Object.entries(s.busy).some(([k, v]) => v && k.startsWith("scenario:")));
  const runIds = useStore((s) => s.scenarioRuns[sc.id]);
  const cache = useStore((s) => s.decisionCache);
  const results = (runIds ?? []).map((id) => cache[id]).filter(Boolean);
  const exp = expectedVerdicts(sc.expected);
  const injectionRan = useStore((s) => s.scenarioRuns.injection !== undefined || s.decisions.some((d) => d.simulated_adversary));
  const replanBusy = useStore((s) => s.busy["scenario:injection-safe-replan"] ?? false);
  const replanIds = useStore((s) => s.scenarioRuns["injection-safe-replan"]);
  const replanResult = replanIds?.length ? cache[replanIds[replanIds.length - 1]] : undefined;

  return (
    <div className={cx("ig-card group relative overflow-hidden p-2.5 transition-colors", busy && "border-ibm/50")}>
      {busy && <div className="absolute inset-x-0 top-0 h-px overflow-hidden"><div className="h-px w-1/2 animate-sweep bg-ibm-2" /></div>}
      <div className="flex items-start gap-2.5">
        <div className="ig-mono flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[3px] border border-line-2 text-[11px] text-fg-2">
          {String(sc.index).padStart(2, "0")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] leading-tight font-medium text-fg">{sc.title}</div>
          <div className="mt-1 text-[11px] leading-snug text-muted">{sc.subtitle}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="ig-label-sm mr-0.5">{results.length ? "Server" : "Expect"}</span>
          {(results.length ? results.map((d) => d.verdict) : exp).map((v, i) => (
            <span key={`${v}-${i}`} className="flex items-center gap-1">
              {i > 0 && <span className="text-[10px] text-dim">then</span>}
              <VerdictChip verdict={v} size="xs" />
            </span>
          ))}
        </div>
        <button type="button" className="ig-btn h-6 px-2 text-[11px]" disabled={anyBusy} onClick={() => void runScenario(sc.id)}>
          {busy ? <Spinner size={11} /> : <Play size={11} />} {results.length ? "Re-run" : "Run"}
        </button>
      </div>
      {sc.id === "injection" && injectionRan && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
          <div className="min-w-0 text-[10.5px] leading-snug text-muted">
            Planner that treats feed text as data only{replanResult ? ":" : "."}
            {replanResult && <VerdictChip verdict={replanResult.verdict} size="xs" className="ml-1.5 align-middle" />}
          </div>
          <button type="button" className="ig-btn ig-btn-allow h-6 shrink-0 px-2 text-[11px]" disabled={anyBusy} onClick={() => void runScenario("injection-safe-replan", { focus: false })}>
            {replanBusy ? <Spinner size={11} /> : <ShieldCheck size={12} />} Re-plan safely
          </button>
        </div>
      )}
    </div>
  );
}

export function ScenarioLauncher() {
  const scenarios = useStore((s) => s.scenarios);
  return (
    <div className="flex flex-col gap-1.5">
      {[...scenarios]
        .sort((a, b) => a.index - b.index)
        .map((sc) => (
          <ScenarioCard key={sc.id} sc={sc} />
        ))}
    </div>
  );
}
