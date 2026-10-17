"""Security properties of the IntentGate Z gateway, exercised through the real HTTP API."""

import copy
import threading

from conftest import run, state


def _action_body(decision):
    a = decision["action"]
    keys = ("agent_id", "intent_id", "intent_version", "action_type", "tool", "target", "parameters", "provenance", "rationale", "required_permissions")
    return {k: copy.deepcopy(a[k]) for k in keys}


def _codes(decision, outcome=None):
    return {f["code"] for f in decision["findings"] if outcome is None or f["outcome"] == outcome}


# ---------------------------------------------------------------- headline scenarios


def test_legitimate_reroute_is_allowed_and_executed(client, sandbox):
    d = run(client, sandbox, "reroute")["decisions"][0]
    assert d["verdict"] == "ALLOW" and d["status"] == "executed"
    amb = next(a for a in state(client, sandbox)["ambulances"] if a["id"] == "amb_03")
    assert amb["route"] == d["executed_route"]
    assert "n_1_3__n_1_4" not in {f"{min(a, b)}__{max(a, b)}" for a, b in zip(amb["route"], amb["route"][1:])}


def test_supply_order_over_budget_is_challenged_not_executed(client, sandbox):
    d = run(client, sandbox, "supply")["decisions"][0]
    assert d["verdict"] == "CHALLENGE" and d["status"] == "pending_review"
    assert "IG-FIN-002" in _codes(d, "challenge")
    assert state(client, sandbox)["purchases"] == []


def test_prompt_injection_is_blocked_and_state_unchanged(client, sandbox):
    before = next(a for a in state(client, sandbox)["ambulances"] if a["id"] == "amb_02")
    res = run(client, sandbox, "injection")
    d = res["decisions"][0]
    assert d["verdict"] == "BLOCK" and d["status"] == "prevented"
    assert d["simulated_adversary"] is True
    assert "IG-TRUST-001" in _codes(d, "block")
    assert d["trust_boundary"]["crossed"] is True
    assert d["ghost_route"], "blocked routing actions expose the would-be route for display only"
    after = next(a for a in state(client, sandbox)["ambulances"] if a["id"] == "amb_02")
    assert after["status"] == "available" and after["route"] == before["route"] == []


def test_intent_drift_is_blocked_even_with_valid_capability(client, sandbox):
    d1, d2 = run(client, sandbox, "drift")["decisions"]
    assert d1["verdict"] == "ALLOW"
    assert d2["verdict"] == "BLOCK"
    caps = {f["code"]: f["outcome"] for f in d2["findings"]}
    assert caps["IG-ID-002"] == "pass", "the agent IS authorised to call the tool"
    assert caps["IG-INT-004"] == "block", "but the human never asked for this operation"
    riverside = next(h for h in state(client, sandbox)["hospitals"] if h["id"] == "hosp_riverside")
    assert riverside["status"] == "accepting"


# ---------------------------------------------------------------- challenge flow


def _approve(client, sb, ch, fingerprint=None, cred=None, approver="sup_okafor"):
    return client.post(
        f"/api/challenges/{ch['challenge_id']}/approve",
        headers={**sb["H"], "X-IG-Supervisor": cred if cred is not None else sb["sup"]},
        json={"approver_id": approver, "approver_role": "supervisor", "reviewed_fingerprint": fingerprint or ch["fingerprint"], "justification": "test"},
    )


def test_approval_requires_supervisor_credential(client, sandbox):
    d = run(client, sandbox, "supply")["decisions"][0]
    r = _approve(client, sandbox, d["challenge"], cred="wrong")
    assert r.status_code == 403


def test_requester_cannot_approve_own_exception(client, sandbox):
    d = run(client, sandbox, "supply")["decisions"][0]
    r = _approve(client, sandbox, d["challenge"], approver=d["intent"]["operator_id"])
    assert r.status_code == 403 and r.json()["error"] == "separation_of_duties"


def test_approval_bound_to_reviewed_fingerprint(client, sandbox):
    d = run(client, sandbox, "supply")["decisions"][0]
    r = _approve(client, sandbox, d["challenge"], fingerprint="0" * 64)
    assert r.status_code == 409


def test_approved_action_executes_once_and_replay_is_rejected(client, sandbox):
    d = run(client, sandbox, "supply")["decisions"][0]
    grant = _approve(client, sandbox, d["challenge"]).json()["grant"]
    r1 = client.post(f"/api/actions/{d['action_id']}/execute", headers=sandbox["H"], json={"grant": grant})
    assert r1.status_code == 200 and r1.json()["status"] == "executed"
    assert len(state(client, sandbox)["purchases"]) == 1
    r2 = client.post(f"/api/actions/{d['action_id']}/execute", headers=sandbox["H"], json={"grant": grant})
    assert r2.status_code == 409 and r2.json()["error"] == "grant_replayed"
    assert len(state(client, sandbox)["purchases"]) == 1


def test_changed_action_cannot_reuse_approval(client, sandbox):
    d = run(client, sandbox, "supply")["decisions"][0]
    grant = _approve(client, sandbox, d["challenge"]).json()["grant"]
    body = _action_body(d)
    body["parameters"]["quantity"] = 4200
    body["parameters"]["total_usd"] = 4200 * body["parameters"]["unit_price_usd"]
    mutated = client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).json()
    assert mutated["verdict"] == "CHALLENGE"
    r = client.post(f"/api/actions/{mutated['action_id']}/execute", headers=sandbox["H"], json={"grant": grant})
    assert r.status_code == 409 and r.json()["error"] == "grant_action_mismatch"
    assert state(client, sandbox)["purchases"] == []


def test_forged_grant_rejected(client, sandbox):
    d = run(client, sandbox, "supply")["decisions"][0]
    grant = _approve(client, sandbox, d["challenge"]).json()["grant"]
    body, sig = grant.rsplit(".", 1)
    forged = body + "." + ("0" if sig[0] != "0" else "1") + sig[1:]
    r = client.post(f"/api/actions/{d['action_id']}/execute", headers=sandbox["H"], json={"grant": forged})
    assert r.status_code == 403


def test_revalidation_blocks_execution_when_conditions_change(client, sandbox):
    """Approval does not bypass hard rules: an intent amendment after approval makes it stale."""
    d = run(client, sandbox, "supply")["decisions"][0]
    grant = _approve(client, sandbox, d["challenge"]).json()["grant"]
    intent = d["intent"]
    amend = {
        "operator_id": intent["operator_id"],
        "operator_role": intent["operator_role"],
        "instruction": "Cancel restock.",
        "authorized_operations": ["purchase_supplies"],
        "permitted_targets": intent["permitted_targets"],
        "financial": intent["financial"],
    }
    # register a new version through the registry (operator amendment)
    from intentgate.api import sessions
    from intentgate.schemas import IntentCreate

    s = sessions.get(sandbox["H"]["X-IG-Session"])
    s.intents.amend(intent["intent_id"], IntentCreate(**amend))
    r = client.post(f"/api/actions/{d['action_id']}/execute", headers=sandbox["H"], json={"grant": grant})
    assert r.status_code == 409 and r.json()["error"] == "revalidation_failed"
    assert state(client, sandbox)["purchases"] == []


def test_hard_ceiling_is_block_not_challenge(client, sandbox):
    d = run(client, sandbox, "supply")["decisions"][0]
    body = _action_body(d)
    body["parameters"]["quantity"] = 20000
    body["parameters"]["total_usd"] = 20000 * body["parameters"]["unit_price_usd"]
    r = client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).json()
    assert r["verdict"] == "BLOCK" and "IG-FIN-002" in _codes(r, "block")


def test_concurrent_execution_race_executes_once(client, sandbox):
    d = run(client, sandbox, "supply")["decisions"][0]
    grant = _approve(client, sandbox, d["challenge"]).json()["grant"]
    codes = []

    def go():
        codes.append(client.post(f"/api/actions/{d['action_id']}/execute", headers=sandbox["H"], json={"grant": grant}).status_code)

    th = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in th]
    [t.join() for t in th]
    assert sorted(codes).count(200) == 1
    assert len(state(client, sandbox)["purchases"]) == 1


# ---------------------------------------------------------------- policy edge cases


def test_over_capacity_destination_blocked(client, sandbox):
    d = run(client, sandbox, "reroute")["decisions"][0]
    client.post("/api/simulation/conditions", headers=sandbox["H"], json={"kind": "hospital", "hospital_id": "hosp_harbor", "beds_available": 0})
    body = _action_body(d)
    body["parameters"]["route"] = None
    r = client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).json()
    assert r["verdict"] == "BLOCK" and "IG-OPS-003" in _codes(r, "block")


def test_wrong_destination_outside_intent_blocked(client, sandbox):
    d = run(client, sandbox, "reroute")["decisions"][0]
    body = _action_body(d)
    body["parameters"]["destination_hospital_id"] = "hosp_eastfield"
    body["parameters"]["route"] = None
    r = client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).json()
    assert r["verdict"] == "BLOCK" and "IG-INT-005" in _codes(r, "block")


def test_capability_mismatch_blocked(client, sandbox):
    d = run(client, sandbox, "reroute")["decisions"][0]
    body = _action_body(d)
    body["agent_id"] = "supply-agent-02"
    r = client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).json()
    assert r["verdict"] == "BLOCK" and "IG-ID-002" in _codes(r, "block")


def test_unknown_agent_blocked(client, sandbox):
    d = run(client, sandbox, "reroute")["decisions"][0]
    body = _action_body(d)
    body["agent_id"] = "rogue-agent-99"
    r = client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).json()
    assert r["verdict"] == "BLOCK" and "IG-ID-001" in _codes(r, "block")


def test_stale_or_unknown_intent_blocked(client, sandbox):
    d = run(client, sandbox, "reroute")["decisions"][0]
    body = _action_body(d)
    body["intent_version"] = 7
    r = client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).json()
    assert r["verdict"] == "BLOCK" and "IG-INT-001" in _codes(r, "block")


def test_benign_suspicious_words_in_trusted_instruction_not_blocked(client, sandbox):
    """Words like 'override' or 'ignore' from the operator's own channel must not trigger a block."""
    r = client.post(
        "/api/intents",
        headers=sandbox["H"],
        json={
            "operator_id": "op_dispatch_chen",
            "instruction": "Ignore the earlier closure notice and override the old detour: reroute MEDIC 3 to Harbor Point now.",
            "authorized_operations": ["reroute_ambulance"],
            "permitted_targets": {"ambulances": ["amb_03"], "hospitals": ["hosp_harbor"]},
        },
    ).json()
    body = {
        "agent_id": "route-planner-01",
        "intent_id": r["intent_id"],
        "intent_version": 1,
        "action_type": "reroute_ambulance",
        "tool": "cad.route.set",
        "target": "amb_03",
        "parameters": {"ambulance_id": "amb_03", "destination_hospital_id": "hosp_harbor"},
        "provenance": [{"source_id": "op_dispatch_chen", "source_type": "operator", "trust": "trusted", "influenced_fields": ["destination_hospital_id"], "excerpt": "Ignore the earlier closure notice and override the old detour"}],
        "rationale": "Following the operator's instruction.",
    }
    d = client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).json()
    assert d["verdict"] in ("ALLOW", "CHALLENGE")
    assert "IG-TRUST-001" not in _codes(d, "block")


def test_phi_egress_blocked(client, sandbox):
    d = run(client, sandbox, "drift")["decisions"][0]
    body = _action_body(d)
    body.update({"action_type": "share_patient_record", "tool": "ehr.record.share", "target": "rec_88213", "parameters": {"record_id": "rec_88213", "recipient": "someone@freemail.example", "purpose": "review"}})
    r = client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).json()
    assert r["verdict"] == "BLOCK" and "IG-DATA-001" in _codes(r, "block")


def test_malformed_parameters_rejected_before_gateway(client, sandbox):
    d = run(client, sandbox, "supply")["decisions"][0]
    body = _action_body(d)
    body["parameters"]["quantity"] = -5
    assert client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).status_code == 422
    body = _action_body(d)
    body["parameters"]["unexpected"] = "x"
    assert client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).status_code == 422


def test_oversized_payload_rejected(client, sandbox):
    huge = "x" * 70000
    r = client.post("/api/actions/evaluate", headers={**sandbox["H"], "Content-Type": "application/json"}, content='{"pad":"' + huge + '"}')
    assert r.status_code == 413


def test_identical_action_replay_blocked(client, sandbox):
    d = run(client, sandbox, "drift")["decisions"][0]
    body = _action_body(d)
    again = client.post("/api/actions/evaluate", headers=sandbox["H"], json=body).json()
    assert again["verdict"] == "BLOCK" and "IG-REPLAY-001" in _codes(again, "block")


def test_no_direct_execution_without_grant(client, sandbox):
    d = run(client, sandbox, "injection")["decisions"][0]
    r = client.post(f"/api/actions/{d['action_id']}/execute", headers=sandbox["H"], json={"grant": "not-a-real-grant-token"})
    assert r.status_code in (400, 403)
    amb = next(a for a in state(client, sandbox)["ambulances"] if a["id"] == "amb_02")
    assert amb["route"] == []


def test_operator_endpoint_requires_token(client):
    assert client.post("/api/admin/reset-all").status_code == 403
    assert client.post("/api/admin/reset-all", headers={"X-IG-Operator": "test-operator-token"}).status_code == 200


def test_sessions_are_isolated(client):
    a = client.post("/api/session").json()
    b = client.post("/api/session").json()
    ha, hb = {"X-IG-Session": a["session_id"]}, {"X-IG-Session": b["session_id"]}
    client.post("/api/scenarios/reroute/run", headers=ha)
    sa = client.get("/api/simulation/state", headers=ha).json()
    sb = client.get("/api/simulation/state", headers=hb).json()
    assert sa["closures"] and not sb["closures"]
