import { useEffect, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { API_BASE } from "../api/client";
import { refreshDecisions, refreshHealth, refreshState } from "../store/actions";
import { useStore } from "../store/store";

/** Shown when the gateway stops answering after boot; the console never fabricates state meanwhile. */
export function BackendBanner() {
  const ok = useStore((s) => s.backendOk);
  const err = useStore((s) => s.backendError);
  const [retrying, setRetrying] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!ok && since === null) setSince(Date.now());
    if (ok) setSince(null);
  }, [ok, since]);

  useEffect(() => {
    if (ok) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [ok]);

  if (ok) return null;
  const secs = since ? Math.round((Date.now() - since) / 1000) : 0;
  return (
    <div className="relative z-[60] flex h-9 shrink-0 items-center justify-center gap-3 border-b border-block/40 bg-[linear-gradient(90deg,rgba(255,93,112,0.14),rgba(255,93,112,0.06))] px-4 text-[12px]">
      <WifiOff size={14} className="text-block" />
      <span className="font-medium text-fg">Gateway unreachable</span>
      <span className="text-muted">
        {API_BASE || window.location.origin}/api · {err ?? "no response"} · last contact {secs}s ago · showing last known server state (frozen)
      </span>
      <button
        type="button"
        className="ig-btn h-6 text-[11px]"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          await refreshHealth();
          await Promise.all([refreshState(), refreshDecisions()]);
          setRetrying(false);
        }}
      >
        <RefreshCw size={12} className={retrying ? "animate-spin" : ""} /> Retry now
      </button>
    </div>
  );
}
