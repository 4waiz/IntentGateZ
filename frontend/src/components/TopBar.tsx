import { MonitorPlay, RotateCcw } from "lucide-react";
import { resetSandbox } from "../store/actions";
import { setQuality, setState, useStore, type Quality, type View } from "../store/store";
import { duration } from "../lib/format";
import { Wordmark } from "./ui/Mark";
import { Dot, cx, Spinner } from "./ui/ui";

const TABS: { id: View; label: string }[] = [
  { id: "command", label: "Command" },
  { id: "proof", label: "IBM Z Proof" },
  { id: "audit", label: "Audit" },
  { id: "studio", label: "Studio" },
];

function GatewayPill() {
  const health = useStore((s) => s.health);
  const ok = useStore((s) => s.backendOk);
  const live = useStore((s) => s.liveConnected);
  const modelOk = health?.model.available ?? false;
  const title = health
    ? `Gateway ${health.version} · uptime ${duration(health.uptime_s)} · risk model: ${health.model.runtime} (${health.model.version})`
    : "Gateway status unknown";
  return (
    <div className="flex h-7 items-stretch overflow-hidden rounded-[4px] border border-line text-[11px]" title={title}>
      <div className="flex items-center gap-1.5 px-2.5">
        <Dot color={ok ? "#00D5B5" : "#FF5D70"} pulse={!ok} />
        <span className="font-medium text-fg">{ok ? "Gateway online" : "Gateway offline"}</span>
        {health && <span className="ig-mono text-[10.5px] text-muted">v{health.version}</span>}
        <span className={cx("ml-1 text-[10px] tracking-[0.1em]", live ? "text-allow" : "text-dim")} title={live ? "Live event stream connected" : "Event stream reconnecting; polling every second"}>
          {live ? "LIVE" : "POLL"}
        </span>
      </div>
      <div className="flex items-center gap-1.5 border-l border-line px-2.5">
        <span className="ig-label-sm">ML</span>
        <span className={modelOk ? "text-allow" : "text-challenge"}>{modelOk ? health?.model.version : "model not loaded"}</span>
      </div>
    </div>
  );
}

function IbmZPill() {
  const platform = useStore((s) => s.platform);
  const health = useStore((s) => s.health);
  const arch = platform?.architecture ?? health?.platform.architecture ?? null;
  const isZ = arch === "s390x";
  const model = platform?.machine_model ?? health?.platform.machine_model ?? null;
  const label = arch === null ? "Platform unknown" : isZ ? `IBM LinuxONE · s390x${model ? ` · ${model}` : ""}` : `Not on IBM Z · ${arch}`;
  return (
    <button
      type="button"
      onClick={() => setState({ view: "proof" })}
      title={`${label}${platform?.machine_type ? ` · machine type ${platform.machine_type}` : ""} · reported live by /api/platform`}
      className="flex h-7 max-w-[300px] items-center gap-2 rounded-[4px] border px-2.5 text-[11px] font-medium"
      style={{
        color: isZ ? "#00D5B5" : "#FFBC5C",
        borderColor: isZ ? "rgba(0,213,181,0.4)" : "rgba(255,188,92,0.4)",
        background: isZ ? "rgba(0,213,181,0.07)" : "rgba(255,188,92,0.07)",
      }}
    >
      <span className="ig-label-sm" style={{ color: "inherit", opacity: 0.8 }}>
        IBM Z
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function QualityToggle() {
  const q = useStore((s) => s.quality);
  const opts: { id: Quality; label: string }[] = [
    { id: "low", label: "Low" },
    { id: "med", label: "Med" },
    { id: "high", label: "High" },
  ];
  return (
    <div className="flex h-7 items-center rounded-[4px] border border-line p-0.5" title="3D quality preset">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setQuality(o.id)}
          className={cx(
            "h-full rounded-[3px] px-2 text-[10.5px] font-medium tracking-[0.08em] uppercase",
            q === o.id ? "bg-white/[0.09] text-fg" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TopBar() {
  const view = useStore((s) => s.view);
  const resetting = useStore((s) => s.busy.reset ?? false);
  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-5 border-b border-line bg-[linear-gradient(180deg,rgba(12,26,40,0.95),rgba(7,17,28,0.95))] px-4">
      <div className="hidden min-[1500px]:block">
        <Wordmark />
      </div>
      <div className="block min-[1500px]:hidden">
        <Wordmark compact />
      </div>

      <nav className="flex h-full items-stretch" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setState({ view: t.id })}
            className={cx(
              "relative flex items-center px-3 text-[12.5px] font-medium tracking-[0.02em] transition-colors",
              view === t.id ? "text-fg" : "text-muted hover:text-fg-2",
            )}
          >
            {t.label}
            {view === t.id && <span className="absolute inset-x-3 bottom-0 h-[2px] bg-ibm" />}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <GatewayPill />
        <IbmZPill />
        <QualityToggle />
        <button type="button" className="ig-btn" onClick={() => void resetSandbox()} disabled={resetting} title="Reset this sandbox to its initial state">
          {resetting ? <Spinner size={12} /> : <RotateCcw size={13} />}
          <span className="hidden min-[1380px]:inline">Reset sandbox</span>
          <span className="inline min-[1380px]:hidden">Reset</span>
        </button>
        <button type="button" className="ig-btn ig-btn-primary" onClick={() => setState({ presentation: true })} title="Presentation mode (P)">
          <MonitorPlay size={14} /> Present
        </button>
      </div>
    </header>
  );
}
