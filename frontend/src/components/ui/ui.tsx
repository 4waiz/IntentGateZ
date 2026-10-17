import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { DecisionStatus, FindingOutcome, TrustLevel, Verdict } from "../../api/types";
import { serverNow } from "../../lib/clock";
import { STATUS_LABEL, VERDICT_COLOR } from "../../lib/constants";
import { shortHash } from "../../lib/format";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Re-renders every `intervalMs` and returns the current server time (epoch seconds). */
export function useServerNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function SectionLabel({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between gap-2", className)}>
      <span className="ig-label">{children}</span>
      {right}
    </div>
  );
}

const VERDICT_BG: Record<Verdict, string> = {
  ALLOW: "rgba(0,213,181,0.12)",
  CHALLENGE: "rgba(255,188,92,0.12)",
  BLOCK: "rgba(255,93,112,0.12)",
};

const VERDICT_BORDER: Record<Verdict, string> = {
  ALLOW: "rgba(0,213,181,0.45)",
  CHALLENGE: "rgba(255,188,92,0.45)",
  BLOCK: "rgba(255,93,112,0.5)",
};

export function VerdictChip({ verdict, size = "sm", className }: { verdict: Verdict; size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  const s =
    size === "lg"
      ? "h-9 px-3.5 text-[17px] tracking-[0.16em] gap-2"
      : size === "md"
        ? "h-6 px-2 text-[11.5px] tracking-[0.14em] gap-1.5"
        : size === "xs"
          ? "h-[17px] px-1 text-[9.5px] tracking-[0.07em] gap-1"
          : "h-5 px-1.5 text-[10.5px] tracking-[0.12em] gap-1.5";
  return (
    <span
      className={cx("inline-flex shrink-0 items-center rounded-[3px] border font-semibold uppercase leading-none", s, className)}
      style={{ color: VERDICT_COLOR[verdict], background: VERDICT_BG[verdict], borderColor: VERDICT_BORDER[verdict] }}
    >
      <VerdictGlyph verdict={verdict} size={size === "lg" ? 15 : size === "md" ? 11 : size === "xs" ? 8 : 9} />
      {verdict}
    </span>
  );
}

export function VerdictGlyph({ verdict, size = 10 }: { verdict: Verdict; size?: number }) {
  const c = VERDICT_COLOR[verdict];
  if (verdict === "ALLOW")
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="5" fill="none" stroke={c} strokeWidth="1.4" />
        <path d="M3.6 6.2 5.3 7.8 8.5 4.4" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (verdict === "CHALLENGE")
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.2 11 10.4H1L6 1.2Z" fill="none" stroke={c} strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M6 4.6v2.6M6 8.7v.1" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4 1h4l3 3v4l-3 3H4L1 8V4l3-3Z" fill="none" stroke={c} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M4.3 4.3 7.7 7.7M7.7 4.3 4.3 7.7" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

const STATUS_TONE: Record<DecisionStatus, string> = {
  executed: "#00D5B5",
  pending_review: "#FFBC5C",
  prevented: "#FF5D70",
  rejected: "#FF5D70",
  expired: "#8496A8",
};

export function StatusTag({ status }: { status: DecisionStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-2">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_TONE[status] }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function OutcomeIcon({ outcome }: { outcome: FindingOutcome }) {
  if (outcome === "pass")
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" aria-label="pass">
        <circle cx="6" cy="6" r="5.2" fill="rgba(0,213,181,0.1)" stroke="#00D5B5" strokeWidth="1" />
        <path d="M3.7 6.2 5.3 7.7 8.4 4.5" fill="none" stroke="#00D5B5" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (outcome === "info")
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" aria-label="info">
        <circle cx="6" cy="6" r="5.2" fill="rgba(69,137,255,0.1)" stroke="#4589FF" strokeWidth="1" />
        <path d="M6 5.3v3.2M6 3.5v.1" stroke="#4589FF" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  if (outcome === "challenge") return <VerdictGlyph verdict="CHALLENGE" size={13} />;
  return <VerdictGlyph verdict="BLOCK" size={13} />;
}

export function TrustBadge({ trust }: { trust: TrustLevel }) {
  const map: Record<TrustLevel, { c: string; bg: string; label: string }> = {
    trusted: { c: "#00D5B5", bg: "rgba(0,213,181,0.08)", label: "TRUSTED" },
    internal: { c: "#4589FF", bg: "rgba(69,137,255,0.08)", label: "INTERNAL" },
    untrusted: { c: "#FF5D70", bg: "rgba(255,93,112,0.08)", label: "UNTRUSTED" },
  };
  const m = map[trust];
  return (
    <span
      className="inline-flex h-[16px] items-center rounded-[2px] border px-1 text-[9px] font-semibold tracking-[0.12em]"
      style={{ color: m.c, background: m.bg, borderColor: `${m.c}55` }}
    >
      {m.label}
    </span>
  );
}

export function Dot({ color, pulse = false, size = 6 }: { color: string; pulse?: boolean; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {pulse && <span className="absolute inset-0 rounded-full opacity-60 animate-ping" style={{ background: color }} />}
      <span className="relative inline-flex rounded-full" style={{ width: size, height: size, background: color, boxShadow: `0 0 6px ${color}` }} />
    </span>
  );
}

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => (timer.current ? window.clearTimeout(timer.current) : undefined), []);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cx("inline-flex h-5 w-5 items-center justify-center rounded-[3px] text-muted hover:bg-white/5 hover:text-fg", className)}
      onClick={() => {
        const finish = () => {
          setDone(true);
          timer.current = window.setTimeout(() => setDone(false), 1200);
        };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(finish, finish);
        else finish();
      }}
    >
      {done ? <Check size={12} className="text-allow" /> : <Copy size={12} />}
    </button>
  );
}

export function HashText({ value, n = 12, copy = true, className }: { value: string | null | undefined; n?: number; copy?: boolean; className?: string }) {
  if (!value) return <span className="ig-mono text-dim">n/a</span>;
  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      <span className="ig-mono text-[11px] text-fg-2" title={value}>
        {shortHash(value, n)}
      </span>
      {copy && <CopyButton value={value} label="Copy full hash" />}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 880,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[#02060b]/70 p-4 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className="ig-panel flex max-h-[88vh] w-full flex-col overflow-hidden rounded-md shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
            style={{ maxWidth: width }}
            initial={{ y: 12, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold tracking-[0.02em] text-fg">{title}</div>
                {subtitle && <div className="mt-0.5 text-[11.5px] text-muted">{subtitle}</div>}
              </div>
              <button type="button" className="ig-btn ig-btn-ghost h-7 w-7 px-0" onClick={onClose} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Spinner({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={cx("animate-spin", className)} aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function KV({ k, v, mono = false, className }: { k: ReactNode; v: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 py-[3px]", className)}>
      <span className="shrink-0 text-[11.5px] text-muted">{k}</span>
      <span className={cx("min-w-0 text-right text-[12px] text-fg", mono && "ig-mono text-[11.5px]")}>{v}</span>
    </div>
  );
}

export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[4px] border border-dashed border-line px-3 py-3 text-[11.5px] leading-relaxed text-muted", className)}>{children}</div>;
}
