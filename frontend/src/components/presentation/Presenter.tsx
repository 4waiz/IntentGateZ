import { useEffect } from "react";
import { setState, useStore } from "../../store/store";

export function usePresenterKeys(): void {
  const presentation = useStore((s) => s.presentation);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "p" || e.key === "P") setState({ presentation: !presentation });
      if (e.key === "Escape" && presentation) setState({ presentation: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation]);
}

export function PresenterHeader() {
  return <div className="h-11 border-b border-line" />;
}

export function PresenterOverlay() {
  return null;
}
