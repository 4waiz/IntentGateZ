import { useMemo } from "react";
import type { Agent, Ambulance, City, FeedItem, Incident, Person } from "../api/types";
import { useStore } from "../store/store";
import { PATIENT_RECORDS, ROLE_LABEL, SUPPLIERS, SUPPLY_CATALOG } from "./constants";

export interface Names {
  hospital(id: string | null | undefined): string;
  ambulance(id: string | null | undefined): string;
  agent(id: string | null | undefined): string;
  agentInfo(id: string | null | undefined): Agent | undefined;
  operator(id: string | null | undefined): string;
  role(role: string | null | undefined): string;
  supplier(id: string | null | undefined): string;
  sku(id: string | null | undefined): string;
  record(id: string | null | undefined): string;
  incident(id: string | null | undefined): string;
  feed(id: string | null | undefined): string;
  /** Best-effort label for any entity id */
  entity(id: string | null | undefined): string;
}

export interface NameSources {
  ambulances: Ambulance[];
  incidents: Incident[];
  feeds: FeedItem[];
}

export function makeNames(city: City | null, sim: NameSources | null, agents: Agent[], operators: Record<string, Person> | undefined, supervisor: Person | undefined): Names {
  const hosp = new Map((city?.hospitals ?? []).map((h) => [h.id, h.name] as const));
  const amb = new Map((sim?.ambulances ?? []).map((a) => [a.id, a.call_sign] as const));
  const ag = new Map(agents.map((a) => [a.agent_id, a] as const));
  const ops = new Map<string, string>();
  for (const p of Object.values(operators ?? {})) ops.set(p.id, p.name);
  if (supervisor) ops.set(supervisor.id, supervisor.name);
  const inc = new Map((sim?.incidents ?? []).map((i) => [i.id, i.description] as const));
  const feeds = new Map((sim?.feeds ?? []).map((f) => [f.id, f.source] as const));
  const fb = (v: string | null | undefined) => v ?? "n/a";
  const names: Names = {
    hospital: (id) => (id ? hosp.get(id) ?? id : "n/a"),
    ambulance: (id) => (id ? amb.get(id) ?? id.replace("amb_0", "MEDIC ").replace("amb_", "MEDIC ") : "n/a"),
    agent: (id) => (id ? ag.get(id)?.name ?? id : "n/a"),
    agentInfo: (id) => (id ? ag.get(id) : undefined),
    operator: (id) => (id ? ops.get(id) ?? id : "n/a"),
    role: (r) => (r ? ROLE_LABEL[r] ?? r : "n/a"),
    supplier: (id) => (id ? SUPPLIERS[id] ?? id : "n/a"),
    sku: (id) => (id ? SUPPLY_CATALOG[id]?.name ?? id : "n/a"),
    record: (id) => (id ? PATIENT_RECORDS[id] ?? id : "n/a"),
    incident: (id) => (id ? inc.get(id) ?? id : "n/a"),
    feed: (id) => (id ? feeds.get(id) ?? id : "n/a"),
    entity: (id) => {
      if (!id) return fb(id);
      if (hosp.has(id)) return hosp.get(id) ?? id;
      if (amb.has(id)) return amb.get(id) ?? id;
      if (SUPPLIERS[id]) return SUPPLIERS[id];
      if (PATIENT_RECORDS[id]) return `Record ${id}`;
      if (ag.has(id)) return ag.get(id)?.name ?? id;
      return id;
    },
  };
  return names;
}

export function useNames(): Names {
  const city = useStore((s) => s.city);
  const agents = useStore((s) => s.agents);
  const session = useStore((s) => s.session);
  // Select identity keys only (strings compare by value), so position updates do not re-render.
  const ambKey = useStore((s) => s.sim?.ambulances.map((a) => `${a.id}:${a.call_sign}`).join("|") ?? "");
  const incKey = useStore((s) => s.sim?.incidents.map((i) => `${i.id}:${i.description}`).join("|") ?? "");
  const feedKey = useStore((s) => s.sim?.feeds.map((f) => f.id).join("|") ?? "");
  return useMemo(() => {
    const sim = useStore.getState().sim;
    const src: NameSources = { ambulances: sim?.ambulances ?? [], incidents: sim?.incidents ?? [], feeds: sim?.feeds ?? [] };
    return makeNames(city, src, agents, session?.operators, session?.supervisor);
    // ambKey/incKey/feedKey intentionally drive recomputation
  }, [city, agents, session, ambKey, incKey, feedKey]);
}
