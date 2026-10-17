import { useEffect } from "react";
import { create } from "zustand";
import { AnimatePresence, motion } from "motion/react";
import { KeyRound, Pause, Play, Repeat, ShieldCheck, SkipForward, X } from "lucide-react";
import type { Decision, Verdict } from "../../api/types";
import { api } from "../../api/client";
import { STATUS_LABEL, VERDICT_COLOR } from "../../lib/constants";
import { ms, num, opLabel, shortHash } from "../../lib/format";
import { approveChallenge, errorText, executeWithGrant, focusEntity, resetSandbox, runScenario } from "../../store/actions";
import { commandCamera, getState, setState, useStore } from "../../store/store";
import { Mark } from "../ui/Mark";
import { VerdictChip } from "../ui/ui";

type Card =
  | { kind: "intro" }
  | { kind: "title"; index: number; title: string; subtitle: string; expected: string }
  | { kind: "verdict"; verdict: Verdict; heading: string; reason: string; latency: number | undefined; hash: string | undefined; status: string; adversary: boolean; step?: string }
  | { kind: "info"; tone: "allow" | "challenge" | "block" | "ibm"; heading: string; lines: string[]; mono?: string }
  | { kind: "end"; decisions: number; counts: Record<Verdict, number>; chain: string | null };

interface PresenterState {
  running: boolean;
  paused: boolean;
  card: Card | null;
  caption: string;
  progress: number; // 0..4 scenarios completed
  error: string | null;
}

const usePresenter = create<PresenterState>()(() => ({ running: false, paused: false, card: null, caption: "", progress: 0, error: null }));
const P = { get: usePresenter.getState, set: usePresenter.setState };

class Cancelled extends Error {}

let runId = 0;
let skip = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** Waits `ms` while honouring pause, skip-to-next and cancellation. */
async function hold(id: number, total: number): Promise<void> {
  let left = total;
  skip = false;
  while (left > 0 || P.get().paused) {
    if (id !== runId) throw new Cancelled();
    if (skip) {
      skip = false;
      return;
    }
    await sleep(100);
    if (!P.get().paused) left -= 100;
  }
  if (id !== runId) throw new Cancelled();
}

function guard(id: number): void {
  if (id !== runId) throw new Cancelled();
}

function reasonLine(d: Decision): string {
  const decisive = d.findings.filter((f) => f.outcome === (d.verdict === "BLOCK" ? "block" : d.verdict === "CHALLENGE" ? "challenge" : "pass"));
  if (d.verdict === "ALLOW") {
    const passed = d.findings.filter((f) => f.outcome === "pass").length;
    return `${passed} policy checks passed; the action matches the operator's intent.`;
  }
  return decisive.length ? decisive.map((f) => f.message).slice(0, 2).join(" ") : d.explanation;
}

function verdictCard(d: Decision, step?: string): Card {
  return {
    kind: "verdict",
    verdict: d.verdict,
    heading: `${opLabel(d.action.action_type)} · ${d.action.agent_id}`,
    reason: reasonLine(d),
    latency: d.latency_ms.decision_ms,
    hash: d.audit.outcome?.hash ?? d.audit.decision?.hash,
    status: STATUS_LABEL[d.status],
    adversary: d.simulated_adversary,
    step,
  };
}

async function script(id: number): Promise<void> {
  const show = (card: Card | null, caption = P.get().caption) => {
    guard(id);
    P.set({ card, caption });
  };
  show({ kind: "intro" }, "Resetting the sandbox through the real API");
  await resetSandbox();
  commandCamera("overview");
  await hold(id, 3200);

  const scenarios = [...getState().scenarios].sort((a, b) => a.index - b.index);
  for (const sc of scenarios) {
    show({ kind: "title", index: sc.index, title: sc.title, subtitle: sc.subtitle, expected: sc.expected }, `Scenario ${sc.index}: ${sc.title}`);
    focusEntity(sc.focus);
    await hold(id, 3400);
    show(null, `Agent ${sc.agent_id} proposes an action; the gateway evaluates it`);
    const res = await runScenario(sc.id, { quiet: true });
    guard(id);
    if (!res) throw new Error(`scenario ${sc.id} returned nothing`);
    await hold(id, 1400);

    for (let i = 0; i < res.decisions.length; i++) {
      const d = res.decisions[i];
      show(verdictCard(d, res.decisions.length > 1 ? `Step ${i + 1} of ${res.decisions.length}` : undefined), `Verdict from the gateway: ${d.verdict}`);
      await hold(id, 5200);
    }

    if (sc.id === "supply") {
      const d = res.decisions[0];
      const ch = getState().sim?.challenges.find((c) => c.decision_id === d.decision_id) ?? d.challenge;
      if (ch && ch.status === "pending") {
        show(null, `Supervisor ${ch.required_approver.name} reviews and approves the exception`);
        const grant = await approveChallenge(ch, "Presentation: surge order approved after review.");
        guard(id);
        if (grant) {
          show(
            { kind: "info", tone: "ibm", heading: "Single-use approval grant issued", lines: [`Bound to action ${ch.action_id} and its fingerprint.`, `Valid for ${grant.ttl_s} s; usable exactly once.`], mono: grant.grant_id },
            "Approval grant issued by the gateway",
          );
          await hold(id, 3600);
          const ok = await executeWithGrant(ch, "execute");
          guard(id);
          show(
            ok
              ? { kind: "info", tone: "allow", heading: "Executed with approval", lines: ["Hard policy re-validated at execution time.", "Purchase order applied in the simulated ERP."] }
              : { kind: "info", tone: "block", heading: "Execution refused", lines: [lastLog(ch.challenge_id)] },
            "Executing with the supervisor's grant",
          );
          await hold(id, 3600);
          show(null, "Security test: replaying the same approval");
          await executeWithGrant(ch, "replay");
          guard(id);
          show({ kind: "info", tone: "block", heading: "Replay rejected by the gateway", lines: [lastLog(ch.challenge_id)] }, "Approvals are single-use");
          await hold(id, 5000);
        }
      }
    }

    if (sc.id === "injection") {
      show(null, "The ghost route shows what the poisoned plan would have done; MEDIC 2 never moved");
      commandCamera("blocked");
      await hold(id, 4800);
      show(null, "Re-planning with a planner that treats feed text as data only");
      const safe = await runScenario("injection-safe-replan", { quiet: true, focus: false });
      guard(id);
      const sd = safe?.decisions[0];
      if (sd) {
        commandCamera("ambulance", "amb_02");
        show(verdictCard(sd, "Safe re-plan"), `Verdict from the gateway: ${sd.verdict}`);
        await hold(id, 5200);
      }
    }
    P.set({ progress: sc.index });
  }

  commandCamera("orbit");
  let chain: string | null = null;
  try {
    const v = await api.auditVerify();
    chain = v.ok ? `Audit chain verified: ${num(v.records_checked)} records intact` : `Audit chain broken at seq ${v.first_bad_seq}`;
  } catch {
    chain = null;
  }
  const ds = Object.values(getState().decisionCache);
  const counts: Record<Verdict, number> = { ALLOW: 0, CHALLENGE: 0, BLOCK: 0 };
  for (const d of ds) counts[d.verdict] += 1;
  show({ kind: "end", decisions: ds.length, counts, chain }, "End of demonstration");
}

function lastLog(challengeId: string): string {
  const log = getState().challengeUI[challengeId]?.log ?? [];
  const e = log[log.length - 1];
  return e ? `${e.http} ${e.code}: ${e.message}` : "No response recorded.";
}

export function startPresentation(): void {
  runId += 1;
  const id = runId;
  P.set({ running: true, paused: false, card: null, caption: "", progress: 0, error: null });
  script(id)
    .then(() => {
      if (id === runId) P.set({ running: false });
    })
    .catch((err: unknown) => {
      if (err instanceof Cancelled) return;
      P.set({ running: false, error: errorText(err), card: { kind: "info", tone: "block", heading: "Presentation stopped", lines: [errorText(err)] } });
    });
}

export function stopPresentation(): void {
  runId += 1;
  P.set({ running: false, paused: false, card: null, caption: "" });
  setState({ presentation: false });
}

function advance(): void {
  const { paused } = P.get();
  if (paused) P.set({ paused: false });
  skip = true;
}

export function usePresenterKeys(): void {
  const presentation = useStore((s) => s.presentation);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        if (presentation) stopPresentation();
        else setState({ presentation: true });
        return;
      }
      if (!presentation) return;
      if (e.key === "Escape") {
        e.preventDefault();
        stopPresentation();
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        // Space: pause while running; when paused, advance to the next step and resume.
        if (P.get().paused) advance();
        else P.set({ paused: true });
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation]);

  // Start the sequence whenever presentation mode is entered.
  useEffect(() => {
    if (presentation) startPresentation();
    else if (P.get().running) {
      runId += 1;
      P.set({ running: false, card: null });
    }
  }, [presentation]);
}

export function PresenterHeader() {
  const { running, paused, progress } = usePresenter();
  const scenarios = useStore((s) => s.scenarios);
  return (
    <header className="relative z-40 flex h-11 shrink-0 items-center gap-4 border-b border-line bg-[linear-gradient(180deg,rgba(12,26,40,0.95),rgba(7,17,28,0.92))] px-4">
      <div className="flex items-center gap-2">
        <Mark size={20} />
        <span className="text-[12px] font-semibold tracking-[0.2em] text-fg">INTENTGATE</span>
        <span className="text-[12px] font-semibold text-allow">Z</span>
        <span className="ml-2 text-[11px] tracking-[0.12em] text-muted uppercase">Live demonstration · real API</span>
      </div>
      <div className="flex items-center gap-1.5">
        {[...scenarios]
          .sort((a, b) => a.index - b.index)
          .map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 text-[10.5px] text-muted">
              <span className={progress >= s.index ? "h-1.5 w-6 rounded-full bg-allow" : "h-1.5 w-6 rounded-full bg-white/10"} />
            </span>
          ))}
      </div>
      <div className="ml-auto flex items-center gap-2 text-[10.5px] text-dim">
        <span className="hidden md:inline">
          <kbd className="ig-mono rounded border border-line px-1">Space</kbd> pause/next · <kbd className="ig-mono rounded border border-line px-1">→</kbd> next ·{" "}
          <kbd className="ig-mono rounded border border-line px-1">Esc</kbd> exit
        </span>
        <button type="button" className="ig-btn h-7" onClick={() => (paused ? advance() : P.set({ paused: true }))} disabled={!running}>
          {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" className="ig-btn h-7" onClick={advance} disabled={!running}>
          <SkipForward size={13} /> Next
        </button>
        {!running && (
          <button type="button" className="ig-btn h-7" onClick={startPresentation}>
            <Repeat size={13} /> Restart
          </button>
        )}
        <button type="button" className="ig-btn h-7" onClick={stopPresentation}>
          <X size={13} /> Exit
        </button>
      </div>
    </header>
  );
}

function CardView({ card }: { card: Card }) {
  if (card.kind === "intro")
    return (
      <div className="flex flex-col items-center text-center">
        <Mark size={58} animated />
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-[30px] font-semibold tracking-[0.22em] text-fg">INTENTGATE</span>
          <span className="text-[30px] font-semibold tracking-[0.1em] text-allow">Z</span>
        </div>
        <div className="mt-2 text-[15px] text-fg-2">Real-time intent security for autonomous AI agents</div>
        <div className="mt-1 text-[12px] text-muted">Four scenarios, run live against the gateway. Every verdict on screen comes from the server.</div>
      </div>
    );
  if (card.kind === "title")
    return (
      <div className="max-w-[720px]">
        <div className="ig-mono text-[13px] tracking-[0.2em] text-ibm-2">SCENARIO {String(card.index).padStart(2, "0")}</div>
        <div className="mt-2 text-[34px] leading-tight font-semibold text-fg">{card.title}</div>
        <div className="mt-2 text-[15px] leading-relaxed text-fg-2">{card.subtitle}</div>
        <div className="mt-4 text-[11px] tracking-[0.14em] text-muted uppercase">Expected: {card.expected}</div>
      </div>
    );
  if (card.kind === "verdict") {
    const c = VERDICT_COLOR[card.verdict];
    return (
      <div className="w-[640px] max-w-[90vw]">
        <div className="flex items-center justify-between gap-4">
          <VerdictChip verdict={card.verdict} size="lg" />
          <div className="text-right">
            {card.step && <div className="text-[11px] tracking-[0.12em] text-muted uppercase">{card.step}</div>}
            <div className="text-[13px] font-medium" style={{ color: c }}>
              {card.status}
            </div>
          </div>
        </div>
        <div className="mt-3 text-[13px] text-muted">{card.heading}</div>
        <div className="mt-1.5 text-[19px] leading-snug font-medium text-fg">{card.reason}</div>
        {card.adversary && <div className="mt-2 text-[11.5px] text-block">Simulated adversarial proposal (deterministic test harness, no live LLM)</div>}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
          <div>
            <div className="ig-label-sm">Decision latency</div>
            <div className="ig-mono mt-1 text-[18px] text-fg">{ms(card.latency)}</div>
          </div>
          <div>
            <div className="ig-label-sm">Audit record hash</div>
            <div className="ig-mono mt-1 text-[18px] text-fg">{shortHash(card.hash, 16)}</div>
          </div>
        </div>
      </div>
    );
  }
  if (card.kind === "info") {
    const c = card.tone === "allow" ? "#00D5B5" : card.tone === "challenge" ? "#FFBC5C" : card.tone === "block" ? "#FF5D70" : "#4589FF";
    return (
      <div className="w-[600px] max-w-[90vw]">
        <div className="flex items-center gap-2 text-[18px] font-semibold" style={{ color: c }}>
          {card.tone === "ibm" ? <KeyRound size={18} /> : <ShieldCheck size={18} />} {card.heading}
        </div>
        {card.mono && <div className="ig-mono mt-2 text-[14px] text-fg">{card.mono}</div>}
        <div className="mt-2 flex flex-col gap-1">
          {card.lines.map((l) => (
            <div key={l} className="text-[14px] leading-snug text-fg-2">
              {l}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center text-center">
      <Mark size={52} />
      <div className="mt-4 text-[28px] font-semibold tracking-[0.16em] text-fg">
        INTENTGATE <span className="text-allow">Z</span>
      </div>
      <div className="mt-2 text-[18px] text-fg-2">Authorized doesn't always mean intended.</div>
      <div className="mt-5 flex items-center gap-3">
        <VerdictChip verdict="ALLOW" size="md" /> <span className="ig-mono text-[14px] text-fg">{card.counts.ALLOW}</span>
        <VerdictChip verdict="CHALLENGE" size="md" /> <span className="ig-mono text-[14px] text-fg">{card.counts.CHALLENGE}</span>
        <VerdictChip verdict="BLOCK" size="md" /> <span className="ig-mono text-[14px] text-fg">{card.counts.BLOCK}</span>
      </div>
      <div className="mt-3 text-[12px] text-muted">
        {card.decisions} decisions in this run{card.chain ? ` · ${card.chain}` : ""}
      </div>
    </div>
  );
}

export function PresenterOverlay() {
  const { card, caption, paused } = usePresenter();
  const center = card && (card.kind === "intro" || card.kind === "end" || card.kind === "title");
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <AnimatePresence mode="wait">
        {card && (
          <motion.div
            key={JSON.stringify(card).slice(0, 120)}
            className={center ? "absolute inset-0 flex items-center justify-center bg-[radial-gradient(800px_420px_at_50%_50%,rgba(5,11,18,0.9),rgba(5,11,18,0.55))]" : "absolute bottom-20 left-1/2 -translate-x-1/2"}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className={center ? "" : "ig-panel rounded-[8px] px-6 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.6)]"}>
              <CardView card={card} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {caption && (
        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-[#07111c]/85 px-4 py-1.5 text-[12px] text-fg-2 backdrop-blur">
          {paused && <span className="text-[10px] font-semibold tracking-[0.14em] text-challenge">PAUSED</span>}
          {caption}
        </div>
      )}
    </div>
  );
}
