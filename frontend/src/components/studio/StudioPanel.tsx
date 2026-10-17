import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, CloudLightning, FilePlus2, Send, TrafficCone } from "lucide-react";
import type { ActionParameters, AgentActionIn, HumanIntent, IntentCreate, OperationType, OperatorRole, Provenance, SimState } from "../../api/types";
import { ALL_OPERATIONS, OPERATION_LABEL, PATIENT_RECORDS, PERMISSION_FOR_OPERATION, SECURITY_FIELD_FOR_OPERATION, SUPPLIERS, SUPPLY_CATALOG, TOOL_FOR_OPERATION } from "../../lib/constants";
import { edgeLabel } from "../../lib/geo";
import { money, shortHash } from "../../lib/format";
import { useNames } from "../../lib/names";
import { changeConditions, createIntent, submitAction } from "../../store/actions";
import { useStore } from "../../store/store";
import { cx, Empty, Spinner, TrustBadge } from "../ui/ui";

type Kind = "ambulance" | "hospital" | "incident" | "incident_opt" | "supplier" | "sku" | "record" | "status" | "int" | "money" | "float" | "text";
interface FieldDef {
  key: string;
  label: string;
  kind: Kind;
}

const FIELDS: Record<OperationType, FieldDef[]> = {
  reroute_ambulance: [
    { key: "ambulance_id", label: "Ambulance", kind: "ambulance" },
    { key: "destination_hospital_id", label: "Destination hospital", kind: "hospital" },
    { key: "incident_id", label: "Incident", kind: "incident_opt" },
  ],
  dispatch_ambulance: [
    { key: "ambulance_id", label: "Ambulance", kind: "ambulance" },
    { key: "incident_id", label: "Incident", kind: "incident" },
    { key: "destination_hospital_id", label: "Destination hospital", kind: "hospital" },
  ],
  reserve_icu_beds: [
    { key: "hospital_id", label: "Hospital", kind: "hospital" },
    { key: "beds", label: "ICU beds", kind: "int" },
    { key: "duration_hours", label: "Duration (h)", kind: "float" },
  ],
  purchase_supplies: [
    { key: "supplier_id", label: "Supplier", kind: "supplier" },
    { key: "item_sku", label: "Item", kind: "sku" },
    { key: "quantity", label: "Quantity", kind: "int" },
    { key: "unit_price_usd", label: "Unit price (USD)", kind: "money" },
    { key: "delivery_hospital_id", label: "Deliver to", kind: "hospital" },
  ],
  update_hospital_status: [
    { key: "hospital_id", label: "Hospital", kind: "hospital" },
    { key: "status", label: "New status", kind: "status" },
  ],
  share_patient_record: [
    { key: "record_id", label: "Record", kind: "record" },
    { key: "recipient", label: "Recipient", kind: "text" },
    { key: "purpose", label: "Purpose", kind: "text" },
  ],
  cancel_dispatch: [
    { key: "ambulance_id", label: "Ambulance", kind: "ambulance" },
    { key: "reason", label: "Reason", kind: "text" },
  ],
};

const TARGET_FIELD: Record<OperationType, string> = {
  reroute_ambulance: "ambulance_id",
  dispatch_ambulance: "ambulance_id",
  cancel_dispatch: "ambulance_id",
  reserve_icu_beds: "hospital_id",
  update_hospital_status: "hospital_id",
  purchase_supplies: "supplier_id",
  share_patient_record: "record_id",
};

function defaultsFor(op: OperationType, intent: HumanIntent | undefined, sim: SimState | null): Record<string, string> {
  const t = intent?.permitted_targets;
  const amb = t?.ambulances[0] ?? sim?.ambulances[0]?.id ?? "amb_01";
  const hosp = t?.hospitals[0] ?? "hosp_harbor";
  const inc = t?.incidents[0] ?? "";
  switch (op) {
    case "reroute_ambulance":
      return { ambulance_id: amb, destination_hospital_id: hosp, incident_id: inc };
    case "dispatch_ambulance":
      return { ambulance_id: amb, incident_id: inc || "INC-2044", destination_hospital_id: hosp };
    case "reserve_icu_beds":
      return { hospital_id: hosp, beds: String(intent?.resource_limits.max_icu_beds ?? 2), duration_hours: "6" };
    case "purchase_supplies": {
      const sku = "sku_trauma_kit";
      return { supplier_id: t?.suppliers[0] ?? "sup_vitalis", item_sku: sku, quantity: "800", unit_price_usd: String(SUPPLY_CATALOG[sku].unit_price_usd), delivery_hospital_id: t?.hospitals[0] ?? "hosp_northgate" };
    }
    case "update_hospital_status":
      return { hospital_id: hosp, status: "diverting" };
    case "share_patient_record":
      return { record_id: "rec_88213", recipient: hosp, purpose: "Continuity of care" };
    case "cancel_dispatch":
      return { ambulance_id: amb, reason: "Incident resolved on scene" };
  }
}

function buildParams(op: OperationType, v: Record<string, string>): ActionParameters {
  const int = (k: string) => Math.trunc(Number(v[k] ?? 0));
  const flt = (k: string) => Number(v[k] ?? 0);
  switch (op) {
    case "reroute_ambulance":
      return { ambulance_id: v.ambulance_id, destination_hospital_id: v.destination_hospital_id, ...(v.incident_id ? { incident_id: v.incident_id } : {}) };
    case "dispatch_ambulance":
      return { ambulance_id: v.ambulance_id, incident_id: v.incident_id, destination_hospital_id: v.destination_hospital_id };
    case "reserve_icu_beds":
      return { hospital_id: v.hospital_id, beds: int("beds"), duration_hours: flt("duration_hours") };
    case "purchase_supplies": {
      const q = int("quantity");
      const u = flt("unit_price_usd");
      return { supplier_id: v.supplier_id, item_sku: v.item_sku, quantity: q, unit_price_usd: u, total_usd: Math.round(q * u * 100) / 100, delivery_hospital_id: v.delivery_hospital_id };
    }
    case "update_hospital_status":
      return { hospital_id: v.hospital_id, status: v.status };
    case "share_patient_record":
      return { record_id: v.record_id, recipient: v.recipient, purpose: v.purpose ?? "" };
    case "cancel_dispatch":
      return { ambulance_id: v.ambulance_id, reason: v.reason ?? "" };
  }
}

function Section({ title, icon, children, defaultOpen = true, accent }: { title: string; icon: ReactNode; children: ReactNode; defaultOpen?: boolean; accent?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line">
      <button type="button" className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-white/[0.015]" onClick={() => setOpen((o) => !o)}>
        <span className="flex items-center gap-2">
          <span style={{ color: accent }} className="text-muted">
            {icon}
          </span>
          <span className="ig-label">{title}</span>
        </span>
        <ChevronDown size={13} className={cx("text-dim transition-transform", !open && "-rotate-90")} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[11px] text-muted">
        {label}
        {hint}
      </span>
      {children}
    </label>
  );
}

// ------------------------------------------------------------------ proposal composer

function Composer({ onNeedIntent }: { onNeedIntent: () => void }) {
  const agents = useStore((s) => s.agents);
  const sim = useStore((s) => s.sim);
  const city = useStore((s) => s.city);
  const busy = useStore((s) => s.busy["studio:submit"] ?? false);
  const names = useNames();
  const intents = useMemo(() => [...(sim?.intents ?? [])].sort((a, b) => b.created_at - a.created_at), [sim?.intents]);

  const [agentId, setAgentId] = useState(agents[0]?.agent_id ?? "");
  const agent = agents.find((a) => a.agent_id === agentId);
  const [op, setOp] = useState<OperationType>(agent?.capabilities[0] ?? "reroute_ambulance");
  const [intentKey, setIntentKey] = useState("");
  const intent = intents.find((i) => `${i.intent_id}:${i.version}` === intentKey) ?? intents[0];
  const [values, setValues] = useState<Record<string, string>>(() => defaultsFor(op, intent, sim));
  const [useFeed, setUseFeed] = useState(false);
  const [feedId, setFeedId] = useState("");
  const [rationale, setRationale] = useState("");

  const feeds = sim?.feeds ?? [];
  const feed = feeds.find((f) => f.id === feedId) ?? feeds.find((f) => f.malicious) ?? feeds[feeds.length - 1];

  useEffect(() => {
    if (agent && !agent.capabilities.includes(op)) setOp(agent.capabilities[0]);
  }, [agent, op]);

  // Re-seed parameters when the operation or the governing intent changes.
  const intentId = intent ? `${intent.intent_id}:${intent.version}` : "";
  useEffect(() => {
    setValues(defaultsFor(op, intents.find((i) => `${i.intent_id}:${i.version}` === intentId), useStore.getState().sim));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, intentId]);

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const authorises = intent ? intent.authorized_operations.includes(op) : false;

  const options = (kind: Kind): { v: string; l: string }[] => {
    switch (kind) {
      case "ambulance":
        return (sim?.ambulances ?? []).map((a) => ({ v: a.id, l: `${a.call_sign} · ${a.status}` }));
      case "hospital":
        return (city?.hospitals ?? []).map((h) => ({ v: h.id, l: h.name }));
      case "incident":
        return (sim?.incidents ?? []).map((i) => ({ v: i.id, l: `${i.id} · ${i.kind.replace(/_/g, " ")}` }));
      case "incident_opt":
        return [{ v: "", l: "none" }, ...(sim?.incidents ?? []).map((i) => ({ v: i.id, l: `${i.id} · ${i.kind.replace(/_/g, " ")}` }))];
      case "supplier":
        return [...Object.entries(SUPPLIERS).map(([v, l]) => ({ v, l })), { v: "sup_unvetted", l: "Unvetted supplier (sup_unvetted)" }];
      case "sku":
        return Object.entries(SUPPLY_CATALOG).map(([v, s]) => ({ v, l: `${s.name} · ${money(s.unit_price_usd, true)}` }));
      case "record":
        return Object.entries(PATIENT_RECORDS).map(([v, l]) => ({ v, l: `${v} · ${l}` }));
      case "status":
        return [
          { v: "accepting", l: "accepting" },
          { v: "diverting", l: "diverting" },
        ];
      default:
        return [];
    }
  };

  const submit = async () => {
    if (!agent || !intent) return;
    const parameters = buildParams(op, values);
    const target = String(parameters[TARGET_FIELD[op]] ?? "");
    const provenance: Provenance[] = [
      {
        source_id: intent.operator_id,
        source_type: "operator",
        trust: "trusted",
        influenced_fields: FIELDS[op].map((f) => f.key).filter((k) => !useFeed || k !== SECURITY_FIELD_FOR_OPERATION[op]),
        excerpt: intent.instruction.slice(0, 300),
      },
    ];
    if (useFeed && feed) {
      provenance.push({
        source_id: feed.id,
        source_type: "external_feed",
        trust: "untrusted",
        influenced_fields: [SECURITY_FIELD_FOR_OPERATION[op]],
        excerpt: feed.text.slice(0, 600),
      });
    }
    const body: AgentActionIn = {
      agent_id: agent.agent_id,
      intent_id: intent.intent_id,
      intent_version: intent.version,
      action_type: op,
      tool: TOOL_FOR_OPERATION[op],
      target,
      parameters,
      provenance,
      rationale: rationale.trim() || `Studio proposal: ${OPERATION_LABEL[op].toLowerCase()} on ${names.entity(target)}.`,
      required_permissions: [PERMISSION_FOR_OPERATION[op]],
    };
    await submitAction(body);
  };

  const total = op === "purchase_supplies" ? Math.round(Number(values.quantity ?? 0) * Number(values.unit_price_usd ?? 0) * 100) / 100 : null;

  return (
    <div className="flex flex-col gap-3">
      <Field label="Agent (authenticated identity)">
        <select className="ig-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.agent_id} value={a.agent_id}>
              {a.name} · {a.agent_id}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tool call">
        <select className="ig-input" value={op} onChange={(e) => setOp(e.target.value as OperationType)}>
          {(agent?.capabilities ?? []).map((c) => (
            <option key={c} value={c}>
              {OPERATION_LABEL[c]} · {TOOL_FOR_OPERATION[c]}
            </option>
          ))}
        </select>
      </Field>

      {intents.length === 0 ? (
        <Empty>
          No human intent is registered in this sandbox yet. Every agent action must cite one. Run a scenario first, or{" "}
          <button type="button" className="text-ibm-2 underline underline-offset-2" onClick={onNeedIntent}>
            register a custom intent
          </button>
          .
        </Empty>
      ) : (
        <Field
          label="Cites human intent"
          hint={
            intent && (
              <span className={cx("text-[10px] font-medium", authorises ? "text-allow" : "text-challenge")}>{authorises ? "authorises this operation" : "does not authorise this operation"}</span>
            )
          }
        >
          <select className="ig-input" value={intent ? `${intent.intent_id}:${intent.version}` : ""} onChange={(e) => setIntentKey(e.target.value)}>
            {intents.map((i) => (
              <option key={`${i.intent_id}:${i.version}`} value={`${i.intent_id}:${i.version}`}>
                {names.operator(i.operator_id)}: {i.instruction.slice(0, 60)}
                {i.instruction.length > 60 ? "…" : ""} (v{i.version})
              </option>
            ))}
          </select>
          {intent && (
            <span className="mt-1 line-clamp-2 border-l border-allow/40 pl-2 text-[11px] leading-snug text-fg-2 italic">“{intent.instruction}”</span>
          )}
        </Field>
      )}

      <div className="ig-card flex flex-col gap-2.5 p-2.5">
        <div className="ig-label-sm">Parameters</div>
        {FIELDS[op].map((f) => {
          const opts = options(f.kind);
          return (
            <Field key={f.key} label={f.label}>
              {opts.length ? (
                <select className="ig-input" value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                  {opts.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="ig-input"
                  type={f.kind === "text" ? "text" : "number"}
                  min={f.kind === "text" ? undefined : 0}
                  step={f.kind === "money" ? "0.01" : f.kind === "float" ? "0.5" : "1"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
            </Field>
          );
        })}
        {total !== null && (
          <div className="flex items-center justify-between border-t border-line pt-2 text-[11.5px]">
            <span className="text-muted">Order total (quantity × unit price)</span>
            <span className="ig-mono font-semibold text-fg">{money(total)}</span>
          </div>
        )}
        {(op === "reroute_ambulance" || op === "dispatch_ambulance") && <div className="text-[10.5px] text-dim">Route omitted: the gateway plans it on the live road network at execution.</div>}
      </div>

      <div className={cx("rounded-[4px] border p-2.5", useFeed ? "border-block/45 bg-block/[0.04]" : "border-line")}>
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" className="mt-0.5 accent-[#FF5D70]" checked={useFeed} onChange={(e) => setUseFeed(e.target.checked)} />
          <span className="text-[12px] text-fg">
            Include untrusted feed instruction
            <span className="block text-[10.5px] leading-snug text-muted">
              Adds an external-feed provenance item that set <span className="ig-mono text-fg-2">{SECURITY_FIELD_FOR_OPERATION[op]}</span>.
            </span>
          </span>
        </label>
        {useFeed && (
          <div className="mt-2 flex flex-col gap-1.5">
            {feeds.length ? (
              <>
                <select className="ig-input" value={feed?.id ?? ""} onChange={(e) => setFeedId(e.target.value)}>
                  {feeds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.id} · {f.source}
                    </option>
                  ))}
                </select>
                {feed && (
                  <div className="flex gap-1.5 text-[10.5px] leading-snug text-fg-2">
                    <TrustBadge trust="untrusted" />
                    <span className="line-clamp-3">{feed.text}</span>
                  </div>
                )}
              </>
            ) : (
              <span className="text-[11px] text-dim">No feed messages in this sandbox.</span>
            )}
          </div>
        )}
      </div>

      <Field label="Agent rationale (optional)">
        <textarea className="ig-input" rows={2} value={rationale} maxLength={2000} onChange={(e) => setRationale(e.target.value)} placeholder="Why the agent proposes this" />
      </Field>

      <button type="button" className="ig-btn ig-btn-primary h-9 text-[12.5px]" disabled={!intent || !agent || busy} onClick={() => void submit()}>
        {busy ? <Spinner size={13} /> : <Send size={14} />} Submit to IntentGate
      </button>
      <div className="text-[10.5px] leading-snug text-dim">
        The proposal goes to <span className="ig-mono">POST /api/actions/evaluate</span>. The verdict, findings and any execution come from the gateway; the console only displays them.
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ environment

function Environment() {
  const idx = useStore((s) => s.cityIndex);
  const sim = useStore((s) => s.sim);
  const busy = useStore((s) => s.busy["studio:conditions"] ?? false);
  const edges = useMemo(() => (idx ? [...idx.city.edges].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) : []), [idx]);
  const [edgeId, setEdgeId] = useState("n_1_3__n_1_4");
  const [hospId, setHospId] = useState("hosp_northgate");
  const hosp = sim?.hospitals.find((h) => h.id === hospId);
  const [beds, setBeds] = useState("");
  const [icu, setIcu] = useState("");
  useEffect(() => {
    setBeds(hosp ? String(hosp.beds_available) : "");
    setIcu(hosp ? String(hosp.icu_available) : "");
    // only when the selection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospId]);
  if (!idx) return null;
  const closed = new Set((sim?.closures ?? []).map((c) => c.edge_id));
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[10.5px] leading-snug text-dim">Environment changes are sandbox conditions (not agent actions); they are recorded in the audit log as environment.changed.</div>
      <Field label="Road segment">
        <select className="ig-input" value={edgeId} onChange={(e) => setEdgeId(e.target.value)}>
          {edges.map((e) => (
            <option key={e.id} value={e.id}>
              {closed.has(e.id) ? "[closed] " : ""}
              {edgeLabel(idx, e.id)} ({e.road_class})
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          className="ig-btn ig-btn-block"
          disabled={busy || closed.has(edgeId)}
          onClick={() => void changeConditions({ kind: "close_road", edge_id: edgeId, reason: "Closed in Scenario Studio" }, `Closed ${edgeLabel(idx, edgeId)}`)}
        >
          Close road
        </button>
        <button type="button" className="ig-btn" disabled={busy || !closed.has(edgeId)} onClick={() => void changeConditions({ kind: "reopen_road", edge_id: edgeId }, `Reopened ${edgeLabel(idx, edgeId)}`)}>
          Reopen
        </button>
      </div>
      {(sim?.closures.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1">
          {sim?.closures.map((c) => (
            <div key={c.edge_id} className="flex items-center justify-between gap-2 rounded-[3px] bg-block/[0.06] px-2 py-1 text-[10.5px]">
              <span className="truncate text-fg-2" title={c.reason}>
                {edgeLabel(idx, c.edge_id)}
              </span>
              <button type="button" className="shrink-0 text-ibm-2 hover:underline" disabled={busy} onClick={() => void changeConditions({ kind: "reopen_road", edge_id: c.edge_id }, `Reopened ${edgeLabel(idx, c.edge_id)}`)}>
                reopen
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ig-divider" />
      <Field label="Hospital">
        <select className="ig-input" value={hospId} onChange={(e) => setHospId(e.target.value)}>
          {(sim?.hospitals ?? []).map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} · {h.status}
            </option>
          ))}
        </select>
      </Field>
      {hosp && (
        <>
          <div className="ig-mono text-[10.5px] text-muted">
            live: beds {hosp.beds_available}/{hosp.beds_total} · ICU {hosp.icu_available}/{hosp.icu_total} · {hosp.status}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" className="ig-btn px-1 text-[11px]" disabled={busy} onClick={() => void changeConditions({ kind: "hospital", hospital_id: hospId, beds_available: 0, reason: "Studio: beds full" }, `${hosp.name}: beds set to 0`)}>
              Beds → 0
            </button>
            <button type="button" className="ig-btn px-1 text-[11px]" disabled={busy} onClick={() => void changeConditions({ kind: "hospital", hospital_id: hospId, icu_available: 0, reason: "Studio: ICU full" }, `${hosp.name}: ICU set to 0`)}>
              ICU → 0
            </button>
            <button
              type="button"
              className={cx("ig-btn px-1 text-[11px]", hosp.status === "accepting" ? "ig-btn-challenge" : "ig-btn-allow")}
              disabled={busy}
              onClick={() =>
                void changeConditions(
                  { kind: "hospital", hospital_id: hospId, status: hosp.status === "accepting" ? "diverting" : "accepting", reason: hosp.status === "accepting" ? "Studio: diverting" : "" },
                  `${hosp.name}: ${hosp.status === "accepting" ? "diverting" : "accepting"}`,
                )
              }
            >
              {hosp.status === "accepting" ? "Divert" : "Accept"}
            </button>
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
            <Field label="Beds free">
              <input className="ig-input" type="number" min={0} max={500} value={beds} onChange={(e) => setBeds(e.target.value)} />
            </Field>
            <Field label="ICU free">
              <input className="ig-input" type="number" min={0} max={200} value={icu} onChange={(e) => setIcu(e.target.value)} />
            </Field>
            <button
              type="button"
              className="ig-btn"
              disabled={busy || beds === "" || icu === ""}
              onClick={() =>
                void changeConditions(
                  { kind: "hospital", hospital_id: hospId, beds_available: Math.max(0, Math.trunc(Number(beds))), icu_available: Math.max(0, Math.trunc(Number(icu))), reason: "Studio capacity update" },
                  `${hosp.name}: beds ${beds}, ICU ${icu}`,
                )
              }
            >
              Apply
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ custom intent

function IntentForm() {
  const session = useStore((s) => s.session);
  const sim = useStore((s) => s.sim);
  const city = useStore((s) => s.city);
  const busy = useStore((s) => s.busy["studio:intent"] ?? false);
  const roles = Object.entries(session?.operators ?? {});
  const [role, setRole] = useState<string>(roles[0]?.[0] ?? "dispatcher");
  const [instruction, setInstruction] = useState("Reroute MEDIC 1 to Northgate Trauma Center for the Canal Street collision; keep the ETA under 15 minutes.");
  const [ops, setOps] = useState<OperationType[]>(["reroute_ambulance"]);
  const [ambs, setAmbs] = useState<string[]>(["amb_01"]);
  const [hosps, setHosps] = useState<string[]>(["hosp_northgate"]);
  const [sups, setSups] = useState<string[]>([]);
  const [incs, setIncs] = useState<string[]>(["INC-2044"]);
  const [budget, setBudget] = useState("50000");
  const [ceiling, setCeiling] = useState("250000");
  const [maxIcu, setMaxIcu] = useState("");
  const [maxEta, setMaxEta] = useState("15");
  const [ttl, setTtl] = useState("60");
  const toggle = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const operator = session?.operators[role];
  const needsMoney = ops.includes("purchase_supplies");

  const submit = async () => {
    if (!operator) return;
    const body: IntentCreate = {
      operator_id: operator.id,
      operator_role: role as OperatorRole,
      instruction: instruction.trim(),
      authorized_operations: ops,
      permitted_targets: { ambulances: ambs, hospitals: hosps, suppliers: sups, incidents: incs },
      resource_limits: { max_icu_beds: maxIcu === "" ? null : Math.trunc(Number(maxIcu)) },
      financial: needsMoney ? { budget_usd: Number(budget), escalation_ceiling_usd: Number(ceiling), approver_role: "supervisor" } : null,
      routing: { avoid_closed_roads: true, max_eta_min: maxEta === "" ? null : Number(maxEta), require_accepting_hospital: true },
      ttl_minutes: Math.max(1, Math.trunc(Number(ttl) || 60)),
    };
    await createIntent(body);
  };

  const Chips = ({ items, sel, set }: { items: { v: string; l: string }[]; sel: string[]; set: (x: string[]) => void }) => (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <button
          key={i.v}
          type="button"
          onClick={() => toggle(sel, i.v, set)}
          className={cx("rounded-[3px] border px-1.5 py-[1px] text-[10.5px]", sel.includes(i.v) ? "border-allow/50 bg-allow/10 text-allow" : "border-line text-muted hover:text-fg")}
        >
          {i.l}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5">
      <Field label="Operator">
        <select className="ig-input" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map(([r, p]) => (
            <option key={r} value={r}>
              {p.name} · {r.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Instruction (what the human actually wants)">
        <textarea className="ig-input" rows={3} maxLength={1000} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
      </Field>
      <Field label="Authorised operations">
        <Chips items={ALL_OPERATIONS.map((o) => ({ v: o, l: OPERATION_LABEL[o] }))} sel={ops} set={(x) => setOps(x as OperationType[])} />
      </Field>
      <Field label="Permitted ambulances">
        <Chips items={(sim?.ambulances ?? []).map((a) => ({ v: a.id, l: a.call_sign }))} sel={ambs} set={setAmbs} />
      </Field>
      <Field label="Permitted hospitals">
        <Chips items={(city?.hospitals ?? []).map((h) => ({ v: h.id, l: h.name.replace(/ (Medical Center|Trauma Center|Hospital|General|Community Hospital|Children's Hospital)$/, "") }))} sel={hosps} set={setHosps} />
      </Field>
      <Field label="Permitted incidents">
        <Chips items={(sim?.incidents ?? []).map((i) => ({ v: i.id, l: i.id }))} sel={incs} set={setIncs} />
      </Field>
      <Field label="Permitted suppliers">
        <Chips items={Object.entries(SUPPLIERS).map(([v, l]) => ({ v, l }))} sel={sups} set={setSups} />
      </Field>
      {needsMoney && (
        <div className="grid grid-cols-2 gap-1.5">
          <Field label="Budget (USD)">
            <input className="ig-input" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          <Field label="Supervisor ceiling (USD)">
            <input className="ig-input" type="number" min={0} value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <Field label="Max ICU beds">
          <input className="ig-input" type="number" min={0} placeholder="none" value={maxIcu} onChange={(e) => setMaxIcu(e.target.value)} />
        </Field>
        <Field label="Max ETA (min)">
          <input className="ig-input" type="number" min={1} placeholder="none" value={maxEta} onChange={(e) => setMaxEta(e.target.value)} />
        </Field>
        <Field label="TTL (min)">
          <input className="ig-input" type="number" min={1} max={1440} value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </Field>
      </div>
      <button type="button" className="ig-btn ig-btn-allow h-8" disabled={busy || !ops.length || instruction.trim().length < 3} onClick={() => void submit()}>
        {busy ? <Spinner size={12} /> : <FilePlus2 size={13} />} Register signed intent
      </button>
      <div className="text-[10.5px] leading-snug text-dim">
        The gateway signs the intent (HMAC) and versions it; agents can only cite it by id. Recent: {(sim?.intents ?? []).slice(-1).map((i) => `${i.intent_id} sig ${shortHash(i.signature, 8)}`)[0] ?? "none"}
      </div>
    </div>
  );
}

export function StudioPanel() {
  const [intentOpen, setIntentOpen] = useState(false);
  const nIntents = useStore((s) => s.sim?.intents.length ?? 0);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="ig-label">Scenario studio</div>
        <div className="mt-1 text-[11.5px] leading-snug text-muted">Compose your own agent proposal, change the sandbox, and watch the gateway decide.</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Compose agent proposal" icon={<Send size={13} />}>
          <Composer onNeedIntent={() => setIntentOpen(true)} />
        </Section>
        <Section title="Sandbox environment" icon={<TrafficCone size={13} />} defaultOpen={false}>
          <Environment />
        </Section>
        <Section key={intentOpen ? "open" : "closed"} title={`Register custom intent${nIntents ? "" : " (none yet)"}`} icon={<CloudLightning size={13} />} defaultOpen={intentOpen || nIntents === 0}>
          <IntentForm />
        </Section>
      </div>
    </div>
  );
}
