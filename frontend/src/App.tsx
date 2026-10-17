import { lazy, Suspense, useEffect } from "react";
import { BackendBanner } from "./components/BackendBanner";
import { CommandPanel } from "./components/command/CommandPanel";
import { Inspector } from "./components/inspector/Inspector";
import { LoadingScreen } from "./components/LoadingScreen";
import { PresenterHeader, PresenterOverlay, usePresenterKeys } from "./components/presentation/Presenter";
import { StudioPanel } from "./components/studio/StudioPanel";
import { BottomStrip } from "./components/timeline/BottomStrip";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { Mark } from "./components/ui/Mark";
import { cx, Spinner } from "./components/ui/ui";
import { CINEMA, exposeForCapture } from "./lib/capture";
import { bootstrap, focusEntity, resetSandbox, runScenario } from "./store/actions";
import "./store/live";
import { commandCamera, getState, setState, useStore } from "./store/store";

exposeForCapture("__igz", { getState, setState, commandCamera, runScenario, resetSandbox, focusEntity });

const CityScene = lazy(() => import("./scene/CityScene"));
const ProofView = lazy(() => import("./components/views/ProofView"));
const AuditView = lazy(() => import("./components/views/AuditView"));

function SceneFallback() {
  return (
    <div className="ig-grid-bg flex h-full w-full items-center justify-center bg-ink">
      <div className="flex flex-col items-center gap-3 text-muted">
        <Mark size={36} />
        <div className="flex items-center gap-2 text-[12px]">
          <Spinner size={12} /> Building the 3D city…
        </div>
      </div>
    </div>
  );
}

function ViewFallback() {
  return (
    <div className="flex h-full items-center justify-center text-[12px] text-muted">
      <Spinner size={12} className="mr-2" /> Loading…
    </div>
  );
}

function Shell() {
  const view = useStore((s) => s.view);
  const presentation = useStore((s) => s.presentation);
  const cityView = presentation || view === "command" || view === "studio";
  const sidePanels = !presentation && (view === "command" || view === "studio");
  usePresenterKeys();

  if (CINEMA)
    return (
      <div className="relative h-full">
        <Suspense fallback={<SceneFallback />}>
          <CityScene active chrome={false} />
        </Suspense>
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      {presentation ? <PresenterHeader /> : <TopBar />}
      <BackendBanner />
      <div className="relative flex min-h-0 flex-1">
        {sidePanels && (
          <aside className={cx("ig-panel relative z-20 shrink-0 border-y-0 border-l-0", view === "studio" ? "w-[372px]" : "w-[300px]")}>
            {view === "studio" ? <StudioPanel /> : <CommandPanel />}
          </aside>
        )}
        <main className="relative min-w-0 flex-1">
          <Suspense fallback={<SceneFallback />}>
            <CityScene active={cityView} />
          </Suspense>
          {!cityView && (
            <div className="absolute inset-0 z-[45] overflow-hidden bg-ink">
              <Suspense fallback={<ViewFallback />}>{view === "proof" ? <ProofView /> : <AuditView />}</Suspense>
            </div>
          )}
          {presentation && <PresenterOverlay />}
        </main>
        {sidePanels && (
          <aside className="ig-panel relative z-20 w-[380px] shrink-0 border-y-0 border-r-0">
            <Inspector />
          </aside>
        )}
      </div>
      {sidePanels && <BottomStrip />}
      <Toasts />
    </div>
  );
}

export default function App() {
  const boot = useStore((s) => s.boot);
  useEffect(() => {
    void bootstrap();
  }, []);
  if (boot !== "ready") return <LoadingScreen />;
  return <Shell />;
}
