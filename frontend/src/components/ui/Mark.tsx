interface MarkProps {
  size?: number;
  className?: string;
  animated?: boolean;
}

/** IntentGate Z mark: a shield outline enclosing a gate (two posts and a lintel). */
export function Mark({ size = 28, className, animated = false }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ig-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00D5B5" />
          <stop offset="1" stopColor="#0F62FE" />
        </linearGradient>
      </defs>
      <path
        d="M16 3.5 26.5 7.4v7.6c0 6.4-4.3 11.1-10.5 12.9C9.8 26.1 5.5 21.4 5.5 15V7.4L16 3.5Z"
        fill="rgba(0,213,181,0.06)"
        stroke="url(#ig-mark-g)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        style={animated ? { strokeDasharray: 90, strokeDashoffset: 90, animation: "ig-draw 1.6s ease-out forwards" } : undefined}
      />
      <path d="M11.4 22.2V12.1M20.6 22.2V12.1M10.4 12.1h11.2" fill="none" stroke="#E8F0F7" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M13.9 16.9h4.2" stroke="#00D5B5" strokeWidth="1.7" strokeLinecap="round" />
      {animated ? <style>{"@keyframes ig-draw{to{stroke-dashoffset:0}}"}</style> : null}
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <Mark size={26} />
      <div className="flex flex-col leading-none">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13.5px] font-semibold tracking-[0.18em] text-fg">INTENTGATE</span>
          <span className="text-[13.5px] font-semibold tracking-[0.1em] text-allow">Z</span>
        </div>
        {!compact && <span className="mt-1 text-[10.5px] tracking-[0.02em] text-muted">Authorized doesn't always mean intended.</span>}
      </div>
    </div>
  );
}
