import type { ReactNode } from "react";
import { Ambulance, Hospital, Map as MapIcon, Navigation, Orbit, RotateCcw, ShieldAlert } from "lucide-react";
import type { Decision } from "../api/types";
import { clockTime } from "../lib/format";
import { commandCamera, currentDecisionId, getState, useStore } from "../store/store";
import { cx, useServerNow } from "../components/ui/ui";

function contextAmbulance(d: Decision | null): string | null {
  const p = d?.action.parameters;
  if (p && typeof p.ambulance_id === "string") return p.ambulance_id;
  const sim = getState().sim;
  const moving = sim?.ambulances.find((a) => !a.ambient && a.route.length > 1 && (a.status === "transporting" || a.status === "dispatched"));
  return moving?.id ?? sim?.ambulances[0]?.id ?? null;
}

function contextHospital(d: Decision | null): string | null {
  const p = d?.action.parameters;
  if (p) {
    for (const k of ["destination_hospital_id", "delivery_hospital_id", "hospital_id"]) {
      const v = p[k];
      if (typeof v === "string") return v;
    }
  }
  return getState().sim?.hospitals[0]?.id ?? null;
}

function ToolButton({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "group relative flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-medium transition-colors disabled:opacity-35",
        active ? "bg-ibm/25 text-fg" : "text-fg-2 hover:bg-white/[0.06] hover:text-fg",
      )}
    >
      {children}
      <span className="hidden min-[1500px]:inline">{label}</span>
    </button>
  );
}

export function CameraToolbar() {
  const mode = useStore((s) => s.cameraMode);
  const d = useStore((s) => {
    const id = currentDecisionId(s);
    return id ? s.decisionCache[id] ?? null : null;
  });
  const hasBlocked = useStore((s) => Object.values(s.decisionCache).some((x) => x.verdict === "BLOCK" && (x.ghost_route?.length ?? 0) > 1));
  return (
    <div className="ig-panel pointer-events-auto flex items-stretch divide-x divide-line overflow-hidden rounded-[5px] shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
      <ToolButton label="Overview" onClick={() => commandCamera("overview")}>
        <MapIcon size={14} />
      </ToolButton>
      <ToolButton label="Orbit" active={mode === "orbit"} onClick={() => commandCamera(mode === "orbit" ? "overview" : "orbit")}>
        <Orbit size={14} />
      </ToolButton>
      <ToolButton
        label="Ambulance"
        onClick={() => {
          const id = contextAmbulance(d);
          if (id) commandCamera("ambulance", id);
        }}
      >
        <Ambulance size={14} />
      </ToolButton>
      <ToolButton
        label="Hospital"
        onClick={() => {
          const id = contextHospital(d);
          if (id) commandCamera("hospital", id);
        }}
      >
        <Hospital size={14} />
      </ToolButton>
      <ToolButton
        label="Follow"
        active={mode === "follow"}
        onClick={() => {
          if (mode === "follow") {
            commandCamera("overview");
            return;
          }
          const id = contextAmbulance(d);
          if (id) commandCamera("follow", id);
        }}
      >
        <Navigation size={14} />
      </ToolButton>
      <ToolButton label="Blocked op" disabled={!hasBlocked} onClick={() => commandCamera("blocked")}>
        <ShieldAlert size={14} />
      </ToolButton>
      <ToolButton label="Reset" onClick={() => commandCamera("reset")}>
        <RotateCcw size={14} />
      </ToolButton>
    </div>
  );
}

export function SceneHud() {
  const now = useServerNow(1000);
  const version = useStore((s) => s.sim?.version ?? 0);
  const speed = useStore((s) => s.sim?.sim_speedup ?? 0);
  const name = useStore((s) => s.city?.name ?? "");
  const mode = useStore((s) => s.cameraMode);
  const followId = useStore((s) => s.followId);
  const followName = useStore((s) => s.sim?.ambulances.find((a) => a.id === s.followId)?.call_sign ?? null);
  return (
    <div className="pointer-events-none flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold tracking-[0.2em] text-fg uppercase">{name.replace(/\s*\(fictional\)/i, "")}</span>
        <span className="text-[10px] tracking-[0.08em] text-muted uppercase">Synthetic city · fictional data</span>
      </div>
      <div className="ig-mono flex items-center gap-2 text-[10px] text-muted">
        <span>server {clockTime(now)}</span>
        <span>·</span>
        <span>sim ×{speed}</span>
        <span>·</span>
        <span>state v{version}</span>
        {mode === "follow" && followId && (
          <>
            <span>·</span>
            <span className="text-allow">following {followName ?? followId}</span>
          </>
        )}
        {mode === "orbit" && (
          <>
            <span>·</span>
            <span className="text-ibm-2">orbit</span>
          </>
        )}
      </div>
    </div>
  );
}

export function Legend() {
  const items: { label: string; swatch: ReactNode }[] = [
    { label: "Authorised route", swatch: <span className="block h-[3px] w-5 rounded-full bg-allow shadow-[0_0_6px_#00D5B5]" /> },
    {
      label: "Blocked proposal",
      swatch: <span className="block h-[3px] w-5" style={{ background: "repeating-linear-gradient(90deg,#FF5D70 0 4px,transparent 4px 7px)" }} />,
    },
    { label: "Pending review", swatch: <span className="block h-2 w-2 rotate-45 border border-challenge bg-challenge/30" /> },
    { label: "Incident", swatch: <span className="block h-2 w-2 rounded-full border border-incident bg-incident/30" /> },
    {
      label: "Road closure",
      swatch: <span className="block h-2 w-4" style={{ background: "repeating-linear-gradient(45deg,#FF5D70 0 3px,#E8F0F7 3px 6px)" }} />,
    },
  ];
  return (
    <div className="ig-panel pointer-events-none flex items-center gap-3.5 rounded-[4px] px-3 py-1.5">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[10px] text-muted">
          {i.swatch}
          {i.label}
        </span>
      ))}
    </div>
  );
}
