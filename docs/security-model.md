# IntentGate Z security model

## What problem the gateway solves

Authentication answers *"is this the agent it claims to be, and may it call this tool?"*.
It does not answer *"is this particular call what the human actually asked for?"*.
IntentGate Z sits between autonomous agents and sensitive tools and answers the second
question before anything executes.

## Trust levels

| Source | Trust | Can it change the registered intent? | Can it influence an action? |
|---|---|---|---|
| Authenticated human operator | `trusted` | Yes, by registering a new signed intent version | Yes |
| First-party systems (CAD road status, bed registry, inventory forecast) | `internal` | No | Yes, as context |
| External feeds, third-party documents, tool output | `untrusted` | No | Only as context; never for security-relevant fields that leave the intent's scope |

Every agent proposal carries **provenance**: which source influenced which parameter.

## Threat model

An attacker may control lower-trust inputs (an external hospital-status feed, a vendor portal
message, a document an agent reads) or may cause an agent to propose malicious or mistaken
tool calls. We assume the attacker cannot read the gateway's signing key, cannot write to the
gateway's process memory, and cannot obtain the per-sandbox supervisor credential.

Attacks the gateway is designed to stop, each covered by an automated test in
`backend/tests/test_gateway_security.py`:

| Attack | Control |
|---|---|
| Prompt injection redirecting an ambulance | Trust-boundary policy (`IG-TRUST-001`), intent target scope (`IG-INT-005`), clinical capability (`IG-OPS-002`), feed/rationale text models feeding the risk model |
| Injection that picks a *permitted* but wrong destination | ML risk model (injection score, rationale deference, ETA ratio); hard policy alone allows ~half of these |
| Out-of-scope operation (intent drift) with valid credentials | `IG-INT-004`: operation not authorised by the human, even though `IG-ID-002` capability passes |
| Spending beyond authority | `IG-FIN-002`: within budget = allow, up to the escalation ceiling = supervisor challenge, above the ceiling = block |
| Order splitting (salami) | `IG-FIN-004` cumulative spend + behavioural features |
| Over-capacity assignment / ICU over-reservation | `IG-OPS-003`, `IG-INT-006`, `IG-OPS-004` |
| Patient-data exfiltration | `IG-DATA-001` |
| Stale or forged intent | HMAC signature + version check (`IG-INT-001/002/003`) |
| Malformed or oversized tool parameters | Pydantic schemas with `extra="forbid"` and bounds; 64 KB body limit |
| Replay of an executed action | Fingerprint replay protection (`IG-REPLAY-001`) |
| Unknown agent / wrong tool | `IG-ID-001`, `IG-ID-002` |

## Decision fusion

1. Hard policy findings are computed first. Any `block` finding forces **BLOCK**; any
   `challenge` finding forces at least **CHALLENGE**.
2. The ML risk model can only escalate (ALLOW → CHALLENGE → BLOCK). It can never relax a
   hard finding.
3. Thresholds (`tau_review`, `tau_block`) are chosen on the validation split subject to a false-block
   rate of at most 2% on legitimate actions.

## The challenge (human review) protocol

1. A CHALLENGE decision creates a pending review bound to the action **fingerprint**
   (SHA-256 of agent, intent id and version, action type, tool, target and parameters).
2. Approval requires the supervisor credential (separate from operator and agent identities),
   the supervisor role, a different person from the requester (separation of duties), and the
   exact fingerprint the supervisor reviewed.
3. The gateway issues an HMAC-signed **grant**: single-use (nonce), short-lived (120 s by
   default), bound to one action id and fingerprint and to the intent version.
4. Execution verifies the grant, rejects reuse (`grant_replayed`), rejects any other action
   (`grant_action_mismatch`), re-checks the stored action's fingerprint, and **re-runs the hard
   policy against current conditions**. Only the specific finding the supervisor approved is
   waived; anything else that changed (intent amended, capacity gone, ceiling exceeded) blocks.
5. Every step is written to the audit chain.

In the public demo each viewer's sandbox has its own demo supervisor credential so judges can
exercise the flow. In production this credential would come from an identity provider with
step-up authentication.

## Audit chain: what it does and does not guarantee

Each audit record stores canonical JSON and `hash = SHA-256(prev_hash | canonical(record))`.
`GET /api/audit/verify` (or `python -m intentgate.audit verify`) recomputes the chain.

* **Detects**: modification, deletion or reordering of any stored record by someone who does not
  also recompute every later hash.
* **Does not guarantee**: immutability. Someone with write access to both the database and the
  code could rebuild the whole chain. Mitigations: the head hash is returned with every
  decision (clients keep independent copies), the log can be exported, and the head can be
  anchored externally (not implemented in this proof of concept).

## Scope and honesty notes

* All operational data is synthetic. No real ambulances, hospitals, patients or payments exist.
* The "compromised planner" in the injection scenario is a deterministic test harness that
  follows instructions found in feed text. It is labelled as a simulated adversarial proposal
  in the UI and API. No language model was compromised.
* The ML labels come from the dataset generator's latent scenario family, not from real
  incident data.
