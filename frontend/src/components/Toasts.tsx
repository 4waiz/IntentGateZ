import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, XOctagon } from "lucide-react";
import { useStore, type ToastTone } from "../store/store";

const TONE: Record<ToastTone, { c: string; Icon: typeof Info }> = {
  info: { c: "#4589FF", Icon: Info },
  success: { c: "#00D5B5", Icon: CheckCircle2 },
  warn: { c: "#FFBC5C", Icon: AlertTriangle },
  error: { c: "#FF5D70", Icon: XOctagon },
};

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed right-4 bottom-[136px] z-[90] flex w-[360px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const { c, Icon } = TONE[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.18 }}
              className="ig-panel pointer-events-auto flex gap-2.5 rounded-[5px] px-3 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)]"
              style={{ borderLeft: `2px solid ${c}` }}
            >
              <Icon size={15} style={{ color: c }} className="mt-px shrink-0" />
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-fg">{t.title}</div>
                {t.message && <div className="mt-0.5 text-[11.5px] leading-snug break-words text-muted">{t.message}</div>}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
