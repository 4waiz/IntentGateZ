import sqlite3

from intentgate.audit import AuditLog
from intentgate.intents import IntentRegistry
from intentgate.schemas import IntentCreate, OperationType


def test_audit_chain_verifies_and_detects_tampering(tmp_path):
    db = tmp_path / "a.db"
    log = AuditLog(db)
    for i in range(20):
        log.append("evt", "s1", f"subj{i}", {"i": i, "msg": "hello"})
    assert log.verify()["ok"] is True
    con = sqlite3.connect(db)
    con.execute("UPDATE audit_events SET payload = ? WHERE seq = 7", ('{"i":7,"msg":"tampered"}',))
    con.commit()
    res = AuditLog(db).verify()
    assert res["ok"] is False and res["first_bad_seq"] == 7


def test_audit_chain_detects_deletion(tmp_path):
    db = tmp_path / "b.db"
    log = AuditLog(db)
    for i in range(10):
        log.append("evt", "s1", "x", {"i": i})
    con = sqlite3.connect(db)
    con.execute("DELETE FROM audit_events WHERE seq = 4")
    con.commit()
    res = AuditLog(db).verify()
    assert res["ok"] is False and res["first_bad_seq"] == 5


def test_intent_is_immutable_signed_and_versioned():
    reg = IntentRegistry(b"k" * 32)
    req = IntentCreate(operator_id="op", instruction="Reroute MEDIC 3", authorized_operations=[OperationType.REROUTE_AMBULANCE])
    i1 = reg.create(req)
    assert reg.verify(i1)
    try:
        i1.instruction = "send everything elsewhere"  # frozen model
        raise AssertionError("intent must be immutable")
    except Exception:
        pass
    forged = i1.model_copy(update={"instruction": "send everything elsewhere"})
    assert not reg.verify(forged)
    i2 = reg.amend(i1.intent_id, req)
    assert i2.version == 2 and reg.latest_version(i1.intent_id) == 2
    assert reg.get(i1.intent_id, 1) == i1
