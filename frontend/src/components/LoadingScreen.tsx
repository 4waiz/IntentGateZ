import { motion } from "motion/react";
import { RefreshCw, ServerCrash } from "lucide-react";
import { API_BASE } from "../api/client";
import { bootstrap } from "../store/actions";
import { useStore } from "../store/store";
import { Mark } from "./ui/Mark";
import { Spinner } from "./ui/ui";

const STEPS = ["Contacting gateway", "Establishing isolated sandbox", "Loading city model", "Synchronising simulation"];

export function LoadingScreen() {
  const boot = useStore((s) => s.boot);
  const step = useStore((s) => s.bootStep);
  const error = useStore((s) => s.bootError);
  const idx = Math.max(0, STEPS.indexOf(step));
  return (
    <div className="ig-grid-bg fixed inset-0 z-[100] flex items-center justify-center bg-ink">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_400px_at_50%_45%,rgba(0,213,181,0.06),transparent_70%)]" />
      <motion.div
        className="relative flex w-[420px] flex-col items-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <Mark size={64} animated />
        <div className="mt-5 flex items-baseline gap-2">
          <span className="text-[20px] font-semibold tracking-[0.26em] text-fg">INTENTGATE</span>
          <span className="text-[20px] font-semibold tracking-[0.12em] text-allow">Z</span>
        </div>
        <div className="mt-1.5 text-[12px] text-muted">Authorized doesn't always mean intended.</div>

        {boot !== "error" ? (
          <div className="mt-9 w-full">
            <div className="flex flex-col gap-2">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-2.5 text-[12px]">
                  <span className="flex h-4 w-4 items-center justify-center">
                    {i < idx ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-allow shadow-[0_0_6px_#00D5B5]" />
                    ) : i === idx ? (
                      <Spinner size={12} className="text-allow" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-dim/50" />
                    )}
                  </span>
                  <span className={i <= idx ? "text-fg-2" : "text-dim"}>{s}</span>
                </div>
              ))}
            </div>
            <div className="relative mt-6 h-px w-full overflow-hidden bg-line">
              <div className="absolute inset-y-0 left-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-allow to-transparent" />
            </div>
          </div>
        ) : (
          <div className="mt-9 w-full rounded-md border border-block/40 bg-block/[0.06] p-4">
            <div className="flex items-center gap-2 text-[13px] font-medium text-block">
              <ServerCrash size={15} /> Gateway unreachable
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-fg-2">
              The console could not reach the IntentGate Z API at <span className="ig-mono text-fg">{API_BASE || window.location.origin}/api</span>. The
              interface only shows server-generated outcomes, so it will not start without the gateway.
            </p>
            <p className="ig-mono mt-2 break-words text-[11px] text-muted">{error}</p>
            <button type="button" className="ig-btn ig-btn-primary mt-3" onClick={() => void bootstrap()}>
              <RefreshCw size={13} /> Retry connection
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
