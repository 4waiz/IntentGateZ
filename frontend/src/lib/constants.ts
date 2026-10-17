import type { OperationType, Verdict, DecisionStatus } from "../api/types";

/**
 * Static display catalogues mirrored from the backend (agents.py / simulation.py). They are used
 * for human-readable labels and Studio defaults only; the gateway validates every value.
 */
export const TOOL_FOR_OPERATION: Record<OperationType, string> = {
  reroute_ambulance: "cad.route.set",
  dispatch_ambulance: "cad.unit.dispatch",
  cancel_dispatch: "cad.unit.cancel",
  reserve_icu_beds: "bedreg.icu.reserve",
  update_hospital_status: "bedreg.status.set",
  purchase_supplies: "erp.purchase_order.create",
  share_patient_record: "ehr.record.share",
};

export const PERMISSION_FOR_OPERATION: Record<OperationType, string> = {
  reroute_ambulance: "cad.route.write",
  dispatch_ambulance: "cad.dispatch.write",
  cancel_dispatch: "cad.dispatch.write",
  reserve_icu_beds: "bedreg.icu.write",
  update_hospital_status: "bedreg.status.write",
  purchase_supplies: "erp.po.create",
  share_patient_record: "ehr.record.share",
};

/** The parameter an untrusted feed would try to steer, per operation (used by Studio). */
export const SECURITY_FIELD_FOR_OPERATION: Record<OperationType, string> = {
  reroute_ambulance: "destination_hospital_id",
  dispatch_ambulance: "destination_hospital_id",
  cancel_dispatch: "ambulance_id",
  reserve_icu_beds: "beds",
  update_hospital_status: "status",
  purchase_supplies: "quantity",
  share_patient_record: "recipient",
};

export const OPERATION_LABEL: Record<OperationType, string> = {
  reroute_ambulance: "Reroute ambulance",
  dispatch_ambulance: "Dispatch ambulance",
  cancel_dispatch: "Cancel dispatch",
  reserve_icu_beds: "Reserve ICU beds",
  update_hospital_status: "Update hospital status",
  purchase_supplies: "Purchase supplies",
  share_patient_record: "Share patient record",
};

export const ALL_OPERATIONS: OperationType[] = [
  "reroute_ambulance",
  "dispatch_ambulance",
  "cancel_dispatch",
  "reserve_icu_beds",
  "update_hospital_status",
  "purchase_supplies",
  "share_patient_record",
];

export const SUPPLIERS: Record<string, string> = {
  sup_vitalis: "Vitalis Medical Supply",
  sup_meridian: "Meridian Pharma Logistics",
};

export const SUPPLY_CATALOG: Record<string, { name: string; unit_price_usd: number }> = {
  sku_trauma_kit: { name: "Trauma response kit", unit_price_usd: 50.0 },
  sku_iv_set: { name: "IV infusion set", unit_price_usd: 12.0 },
  sku_o_neg_unit: { name: "O-negative blood unit", unit_price_usd: 220.0 },
  sku_vent_circuit: { name: "Ventilator circuit", unit_price_usd: 85.0 },
};

export const PATIENT_RECORDS: Record<string, string> = {
  rec_88213: "INC-2041 cardiac patient",
  rec_88240: "INC-2044 trauma patient",
};

export const VERDICT_COLOR: Record<Verdict, string> = {
  ALLOW: "#00D5B5",
  CHALLENGE: "#FFBC5C",
  BLOCK: "#FF5D70",
};

export const VERDICT_WORD: Record<Verdict, string> = {
  ALLOW: "Allowed",
  CHALLENGE: "Challenged",
  BLOCK: "Blocked",
};

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  executed: "Executed",
  pending_review: "Pending review",
  prevented: "Prevented",
  rejected: "Rejected",
  expired: "Expired",
};

export const COLORS = {
  bg: "#050B12",
  panel: "#0C1A28",
  fg: "#E8F0F7",
  muted: "#8496A8",
  allow: "#00D5B5",
  challenge: "#FFBC5C",
  block: "#FF5D70",
  ibm: "#0F62FE",
  incident: "#FF8A4C",
} as const;

export const ROLE_LABEL: Record<string, string> = {
  dispatcher: "Dispatcher",
  logistics_officer: "Logistics officer",
  hospital_coordinator: "Hospital coordinator",
  supervisor: "Supervisor",
};
