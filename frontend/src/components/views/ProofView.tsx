import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Cpu, FileText, Package, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { api, ApiError } from "../../api/client";
import type { AuditVerify, BenchmarkResults, LatencyKey, Metrics, ModelInfoResponse } from "../../api/types";
import { bytes, duration, ms, num, shortHash } from "../../lib/format";
import { refreshPlatform } from "../../store/actions";
import { useStore } from "../../store/store";
import { cx, HashText, Spinner } from "../ui/ui";
import { ArchitectureDiagram } from "./ArchitectureDiagram";
import { ChartGallery, collectChartNames, JsonView } from "./JsonView";

function Card({ title, subtitle, icon, children, className, right }: { title: string; subtitle?: string; icon?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={cx("ig-panel rounded-[6px]", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && <span className="mt-0.5 text-muted">{icon}</span>}
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold tracking-[0.02em] text-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{subtitle}</p>}
          </div>
        </div>
        {right}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Fact({ k, v, src, tone }: { k: string; v: ReactNode; src?: string; tone?: "ok" | "warn" | "bad" | "muted" }) {
  const color = tone === "ok" ? "text-allow" : tone === "warn" ? "text-challenge" : tone === "bad" ? "text-block" : tone === "muted" ? "text-dim" : "text-fg";
  return (
    <div className="grid grid-cols-[170px_1fr_auto] items-baseline gap-3 border-b border-white/[0.04] py-[6px] last:border-0">
      <span className="text-[11.5px] text-muted">{k}</span>
      <span className={cx("ig-mono min-w-0 text-[12px] break-words", color)}>{v}</span>
      {src ? <span className="ig-mono shrink-0 rounded-[2px] bg-white/[0.04] px-1.5 text-[9.5px] leading-[16px] text-dim">{src}</span> : <span />}
    </div>
  );
}

const none = <span className="text-dim">not reported</span>;

const LAT_ROWS: { k: LatencyKey; label: string }[] = [
  { k: "decision_ms", label: "Decision (gateway)" },
  { k: "policy_ms", label: "Hard policy" },
  { k: "features_ms", label: "Feature extraction" },
  { k: "inference_ms", label: "ML inference" },
  { k: "end_to_end_ms", label: "End to end" },
];

export default function ProofView() {
  const platform = useStore((s) => s.platform);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [model, setModel] = useState<ModelInfoResponse | null>(null);
  const [bench, setBench] = useState<BenchmarkResults | null>(null);
  const [benchErr, setBenchErr] = useState<string | null>(null);
  const [verify, setVerify] = useState<AuditVerify | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      refreshPlatform(),
      api.metrics().then(setMetrics, () => undefined),
      api.modelInfo().then(setModel, () => undefined),
      api.benchmarkResults().then(
        (b) => {
          setBench(b);
          setBenchErr(null);
        },
        (e: unknown) => setBenchErr(e instanceof ApiError ? e.message : String(e)),
      ),
    ]);
    setUpdated(new Date());
    setRefreshing(false);
  }, []);

  const runVerify = useCallback(async () => {
    setVerifying(true);
    try {
      setVerify(await api.auditVerify());
    } finally {
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    void runVerify();
    const t = window.setInterval(() => void api.metrics().then(setMetrics, () => undefined), 3000);
    return () => window.clearInterval(t);
  }, [loadAll, runVerify]);

  const isZ = platform?.architecture === "s390x";
  const charts = useMemo(() => (bench ? [...collectChartNames(bench)] : []), [bench]);
  const benchKeys = bench ? Object.keys(bench) : [];
  const risk = model?.risk_model ?? platform?.model ?? null;
  const acc = risk?.accelerator;
  const features = platform?.cpu_features ?? [];
  const totalVerdicts = metrics ? Object.values(metrics.verdicts).reduce((a, b) => a + (b ?? 0), 0) : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1380px] flex-col gap-4 px-6 py-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="ig-label">IBM Z proof</div>
            <h1 className="mt-1 text-[20px] font-semibold tracking-[0.01em] text-fg">What this gateway is actually running on</h1>
            <p className="mt-1 max-w-[860px] text-[12.5px] leading-relaxed text-muted">
              Every value below is read live from the running backend (<span className="ig-mono text-fg-2">/api/platform</span>,{" "}
              <span className="ig-mono text-fg-2">/api/metrics</span>, <span className="ig-mono text-fg-2">/api/model/info</span>,{" "}
              <span className="ig-mono text-fg-2">/api/benchmark/results</span>, <span className="ig-mono text-fg-2">/api/audit/verify</span>). Nothing on this page is
              hard-coded; unreported values say so.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {updated && <span className="ig-mono text-[10.5px] text-dim">refreshed {updated.toLocaleTimeString("en-GB", { hour12: false })}</span>}
            <button type="button" className="ig-btn" onClick={() => void loadAll()} disabled={refreshing}>
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        {platform && !isZ && (
          <div className="flex items-start gap-3 rounded-[6px] border border-challenge/50 bg-[linear-gradient(90deg,rgba(255,188,92,0.14),rgba(255,188,92,0.04))] px-4 py-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-challenge" />
            <div>
              <div className="text-[14px] font-semibold text-challenge">This backend is not running on IBM Z</div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-fg-2">
                The host reports architecture <span className="ig-mono text-fg">{platform.architecture}</span> ({platform.os}). The hardware facts below describe this
                machine, not IBM LinuxONE. Deploy the same build to the LinuxONE server to see s390x facts here; the console never substitutes IBM Z values.
              </p>
            </div>
          </div>
        )}
        {platform && isZ && (
          <div className="flex items-center gap-3 rounded-[6px] border border-allow/45 bg-[linear-gradient(90deg,rgba(0,213,181,0.12),rgba(0,213,181,0.03))] px-4 py-3">
            <ShieldCheck size={18} className="shrink-0 text-allow" />
            <div className="text-[13px] text-fg">
              <span className="font-semibold text-allow">Running on IBM Z.</span> Architecture <span className="ig-mono">s390x</span>
              {platform.machine_model ? (
                <>
                  , machine type <span className="ig-mono">{platform.machine_type}</span> ({platform.machine_model})
                </>
              ) : null}
              , as reported by the host kernel.
            </div>
          </div>
        )}

        <Card title="Request path" subtitle="Every agent action passes through the gateway before any simulated tool can change state.">
          <ArchitectureDiagram onZ={isZ} model={platform?.machine_model ?? null} />
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title="Directly verified hardware facts" subtitle="Read from the host at runtime by platform_info.py." icon={<Cpu size={15} />}>
            {!platform ? (
              <Spinner />
            ) : (
              <>
                <Fact k="Architecture" v={platform.architecture} src="uname -m" tone={isZ ? "ok" : "warn"} />
                <Fact k="Machine type" v={platform.machine_type ? `${platform.machine_type}${platform.machine_model ? ` · ${platform.machine_model}` : ""}` : none} src="/proc/cpuinfo" />
                <Fact k="CPU vendor" v={platform.cpu_vendor ?? none} src="/proc/cpuinfo" />
                <Fact k="CPU model" v={platform.lscpu_model ?? none} src="lscpu" />
                <Fact k="Hypervisor" v={platform.hypervisor ?? none} src="lscpu" />
                <Fact k="Virtualization" v={platform.virtualization ?? none} src="lscpu" />
                <Fact k="Operating system" v={platform.os} src="/etc/os-release" />
                <Fact k="Kernel" v={`${platform.system} ${platform.kernel}`} src="uname -r" />
                <Fact k="CPU count" v={platform.cpu_count ?? none} src="os.cpu_count()" />
                <Fact k="In container" v={platform.in_container ? "yes" : "no"} src="/.dockerenv" />
                <div className="mt-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="ig-label-sm">CPU features ({features.length})</span>
                    <span className={cx("text-[11px] font-medium", features.includes("nnpa") ? "text-allow" : "text-muted")}>
                      {features.includes("nnpa") ? "nnpa present" : "nnpa not listed"}
                    </span>
                  </div>
                  {features.length ? (
                    <div className="flex flex-wrap gap-1">
                      {features.map((f) => (
                        <span
                          key={f}
                          className={cx(
                            "ig-mono rounded-[2px] border px-1 text-[10.5px] leading-[17px]",
                            f === "nnpa" ? "border-allow/60 bg-allow/10 text-allow" : "border-line text-fg-2",
                          )}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11.5px] text-dim">No feature list exposed by this host (no /proc/cpuinfo features line).</div>
                  )}
                </div>
              </>
            )}
          </Card>

          <Card
            title="Verified runtime activity"
            subtitle="Live counters from this gateway process."
            icon={<CheckCircle2 size={15} />}
            right={<span className="ig-mono text-[10px] text-dim">polling 3 s</span>}
          >
            {!metrics ? (
              <Spinner />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {[
                    { k: "Uptime", v: duration(metrics.uptime_s) },
                    { k: "Decisions served", v: num(metrics.decisions) },
                    { k: "ML inferences", v: num(metrics.inference_count) },
                    { k: "Audit records", v: num(metrics.audit_records) },
                  ].map((x) => (
                    <div key={x.k} className="ig-card px-2.5 py-2">
                      <div className="ig-label-sm">{x.k}</div>
                      <div className="ig-mono mt-1 text-[17px] text-fg">{x.v}</div>
                    </div>
                  ))}
                </div>
                {totalVerdicts > 0 && (
                  <div className="mt-3">
                    <div className="flex h-1.5 overflow-hidden rounded-full">
                      {(["ALLOW", "CHALLENGE", "BLOCK"] as const).map((v) => (
                        <div
                          key={v}
                          style={{
                            width: `${((metrics.verdicts[v] ?? 0) / totalVerdicts) * 100}%`,
                            background: v === "ALLOW" ? "#00D5B5" : v === "CHALLENGE" ? "#FFBC5C" : "#FF5D70",
                          }}
                        />
                      ))}
                    </div>
                    <div className="ig-mono mt-1 flex gap-4 text-[10.5px] text-muted">
                      <span className="text-allow">ALLOW {metrics.verdicts.ALLOW ?? 0}</span>
                      <span className="text-challenge">CHALLENGE {metrics.verdicts.CHALLENGE ?? 0}</span>
                      <span className="text-block">BLOCK {metrics.verdicts.BLOCK ?? 0}</span>
                      <span className="ml-auto">all sessions · {num(metrics.http_requests)} HTTP requests · {metrics.sessions_active} sandboxes</span>
                    </div>
                  </div>
                )}
                <table className="mt-3 w-full text-[11.5px]">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="py-1 font-medium">Latency</th>
                      {["n", "p50", "p95", "p99", "max"].map((h) => (
                        <th key={h} className="py-1 text-right font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {LAT_ROWS.map(({ k, label }) => {
                      const st = metrics.latency[k];
                      return (
                        <tr key={k} className="border-t border-white/[0.04]">
                          <td className="py-1 text-fg-2">{label}</td>
                          <td className="ig-mono py-1 text-right text-muted">{st ? st.n : "-"}</td>
                          <td className="ig-mono py-1 text-right text-fg">{st ? ms(st.p50) : "-"}</td>
                          <td className="ig-mono py-1 text-right text-fg">{st ? ms(st.p95) : "-"}</td>
                          <td className="ig-mono py-1 text-right text-fg">{st ? ms(st.p99) : "-"}</td>
                          <td className="ig-mono py-1 text-right text-muted">{st ? ms(st.max) : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!metrics.latency.decision_ms && <div className="mt-1 text-[11px] text-dim">No decisions served yet; run a scenario to populate latency percentiles.</div>}
                <div className="mt-3 grid grid-cols-1 gap-x-6 md:grid-cols-2">
                  <Fact k="Process RSS" v={metrics.memory.process_rss_mb !== null ? `${metrics.memory.process_rss_mb.toFixed(1)} MB` : none} src="/proc/self/status" />
                  <Fact
                    k="Host memory"
                    v={metrics.memory.host_total_mb !== null ? `${(metrics.memory.host_available_mb ?? 0).toFixed(0)} / ${metrics.memory.host_total_mb.toFixed(0)} MB free` : none}
                    src="/proc/meminfo"
                  />
                  <Fact k="Load average" v={metrics.load_avg ? metrics.load_avg.join(" · ") : none} src="os.getloadavg()" />
                  <Fact k="Process" v={platform ? `pid ${platform.pid} · Python ${platform.python}` : none} src="runtime" />
                </div>
              </>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title="Model execution facts" subtitle="What the gateway loaded, as reported by the serving runtime." icon={<Cpu size={15} />}>
            {!risk ? (
              <Spinner />
            ) : (
              <>
                <Fact k="Risk model" v={risk.available ? "loaded" : "not loaded"} tone={risk.available ? "ok" : "warn"} src="/api/model/info" />
                <Fact k="Runtime" v={risk.runtime} />
                <Fact k="Kind · version" v={`${risk.kind} · ${risk.version}`} />
                <Fact
                  k="Thresholds"
                  v={
                    Object.entries(risk.thresholds)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" · ") || none
                  }
                />
                <Fact k="Inference count" v={num(risk.inference_count)} />
                {risk.last_error && <Fact k="Last load error" v={risk.last_error} tone="warn" />}
                <Fact k="Injection detector" v={`${model?.injection_detector.runtime ?? platform?.injection_detector.runtime ?? "n/a"} (${model?.injection_detector.version ?? platform?.injection_detector.version ?? "n/a"})`} />
                <Fact
                  k="Explainer (Granite)"
                  v={(() => {
                    const ex = model?.explainer ?? platform?.explainer;
                    if (!ex) return none;
                    return ex.available ? `${ex.model ?? "model"} via ${ex.backend ?? "backend"}` : `not configured: ${ex.reason ?? "unavailable"}`;
                  })()}
                  tone={(model?.explainer ?? platform?.explainer)?.available ? "ok" : "warn"}
                />
                <Fact k="Explainer role" v={(model?.explainer ?? platform?.explainer)?.role ?? none} tone="muted" />
                {Object.keys(risk.meta).length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11.5px] text-muted hover:text-fg">Model metadata ({Object.keys(risk.meta).length} fields)</summary>
                    <div className="mt-2">
                      <JsonView value={risk.meta} />
                    </div>
                  </details>
                )}
              </>
            )}
          </Card>

          <Card
            title="Accelerator: detection vs utilisation"
            subtitle="Two different claims, verified separately. A CPU facility being present does not mean the model is using it."
            icon={<Cpu size={15} />}
          >
            <div className="flex flex-col gap-2.5">
              <div className="ig-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="ig-label-sm">1 · Detection</div>
                    <div className="mt-1 text-[13px] font-medium text-fg">NNPA facility detected on this CPU</div>
                  </div>
                  <StatusChip ok={platform?.nnpa_facility_detected ?? false} yes="DETECTED" no="NOT DETECTED" />
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
                  Field <span className="ig-mono text-fg-2">nnpa_facility_detected</span> from <span className="ig-mono">/proc/cpuinfo</span> features or{" "}
                  <span className="ig-mono">lscpu</span>. Hardware capability only.
                </p>
              </div>
              <div className="ig-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="ig-label-sm">2 · Utilisation</div>
                    <div className="mt-1 text-[13px] font-medium text-fg">Risk model executing on NNPA</div>
                  </div>
                  <StatusChip ok={acc?.verified ?? false} yes="VERIFIED" no="NOT VERIFIED" />
                </div>
                <div className="mt-1.5 grid grid-cols-1 gap-x-4">
                  <Fact k="model.accelerator.device" v={acc?.device ?? none} tone={acc?.device === "nnpa" ? "ok" : undefined} />
                  <Fact k="model.accelerator.verified" v={acc ? String(acc.verified) : none} tone={acc?.verified ? "ok" : "muted"} />
                  {acc &&
                    Object.entries(acc)
                      .filter(([k, v]) => k !== "device" && k !== "verified" && v !== undefined)
                      .map(([k, v]) => <Fact key={k} k={k} v={typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)} />)}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
                  Reported by the serving runtime in this process (for example torch_nnpa with the model's parameters on the nnpa device and outputs cross-checked against
                  CPU). If it is not verified, inference runs on CPU and the runtime string says so.
                </p>
              </div>
            </div>
          </Card>
        </div>

        <Card
          title="Audit chain integrity"
          subtitle="Recomputes every SHA-256 link of the global audit chain on the server."
          icon={<ShieldCheck size={15} />}
          right={
            <button type="button" className="ig-btn" onClick={() => void runVerify()} disabled={verifying}>
              {verifying ? <Spinner size={12} /> : <ShieldCheck size={13} />} Verify chain
            </button>
          }
        >
          {!verify ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
              <Fact k="Result" v={verify.ok ? "chain intact" : `broken at seq ${verify.first_bad_seq}: ${verify.reason}`} tone={verify.ok ? "ok" : "bad"} />
              <Fact k="Records checked" v={num(verify.records_checked)} />
              <Fact k="Head hash" v={verify.head_hash ? <HashText value={verify.head_hash} n={24} /> : none} />
              <Fact k="Verification time" v={ms(verify.duration_ms)} />
              <Fact k="Algorithm" v={verify.algorithm} />
              <Fact k="Verified at" v={verify.verified_at} />
            </div>
          )}
        </Card>

        <Card
          title="Benchmark results"
          subtitle="Rendered generically from /api/benchmark/results (written by the ML pipeline)."
          icon={<FileText size={15} />}
          right={<span className="ig-mono text-[10.5px] text-dim">{benchKeys.length} result file(s)</span>}
        >
          {benchErr && <div className="text-[12px] text-block">Could not load results: {benchErr}</div>}
          {bench && benchKeys.length === 0 && (
            <div className="rounded-[4px] border border-dashed border-line px-4 py-6 text-center text-[12px] text-muted">
              No benchmark results yet. They appear here automatically once the ML pipeline writes JSON files to <span className="ig-mono text-fg-2">ml/results/</span>.
            </div>
          )}
          {bench && benchKeys.length > 0 && (
            <div className="flex flex-col gap-5">
              <ChartGallery names={charts} />
              {benchKeys.map((k) => (
                <div key={k}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="ig-mono text-[12px] font-medium text-fg">{k}.json</span>
                  </div>
                  <JsonView value={bench[k]} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title="Evidence files" subtitle="Captured command output stored under evidence/ibmz on the server." icon={<FileText size={15} />}>
            {platform?.evidence.length ? (
              <div className="flex flex-col">
                {platform.evidence.map((f) => (
                  <div key={f.file} className="flex items-center justify-between border-b border-white/[0.04] py-1 text-[11.5px] last:border-0">
                    <span className="ig-mono text-fg-2">{f.file}</span>
                    <span className="ig-mono text-dim">{bytes(f.bytes)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11.5px] text-dim">No evidence files on this host yet.</div>
            )}
          </Card>
          <Card title="Software packages" subtitle="Installed versions reported by the Python runtime (importlib.metadata)." icon={<Package size={15} />}>
            {platform ? (
              <div className="grid grid-cols-2 gap-x-6">
                {Object.entries(platform.packages).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between border-b border-white/[0.04] py-1 text-[11.5px]">
                    <span className="text-muted">{k}</span>
                    <span className={cx("ig-mono", v ? "text-fg-2" : "text-dim")}>{v ?? "not installed"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Spinner />
            )}
            {platform && (
              <div className="ig-mono mt-2 text-[10px] text-dim">
                audit head #{platform.audit.seq} {shortHash(platform.audit.hash, 16)}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-[3px] border px-2 py-1 text-[10.5px] font-semibold tracking-[0.12em]",
        ok ? "border-allow/50 bg-allow/10 text-allow" : "border-line-2 bg-white/[0.03] text-muted",
      )}
    >
      {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
      {ok ? yes : no}
    </span>
  );
}
