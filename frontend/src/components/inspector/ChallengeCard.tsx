import { useState } from "react";
import { BadgeCheck, CircleSlash, KeyRound, Play, Repeat, ShieldQuestion, Wrench } from "lucide-react";
import type { Challenge, Decision, JsonValue } from "../../api/types";
import { approveChallenge, executeWithGrant, rejectChallenge, tamperAndReuse } from "../../store/actions";
import { useStore, type ServerLogEntry } from "../../store/store";
import { countdown, money } from "../../lib/format";
import { cx, Spinner, useServerNow } from "../ui/ui";

function numEv(v: JsonValue | undefined): number | null {
  return typeof v === "number" ? v : null;
}

function LogLine({ e }: { e: ServerLogEntry }) {
  const tone = e.ok ? "text-allow" : e.expectedRefusal ? "text-allow" : "text-block";
  return (
    <div className="border-t border-white/[0.05] py-1.5 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <span className="ig-mono truncate text-[10px] text-muted" title={e.action}>
          {e.action}
        </span>
        <span className="ig-mono shrink-0 text-[10px] text-dim">{new Date(e.at).toLocaleTimeString("en-GB", { hour12: false })}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={cx("ig-mono shrink-0 text-[11px] font-medium", e.ok ? "text-allow" : "text-block")}>{e.http === 0 ? "ERR" : e.http}</span>
        <span className={cx("ig-mono shrink-0 text-[11px]", e.ok ? "text-fg" : "text-block")}>{e.code}</span>
        {e.expectedRefusal && !e.ok && <span className={cx("shrink-0 text-[9.5px] font-semibold tracking-[0.1em]", tone)}>REFUSED AS EXPECTED</span>}
      </div>
      <div className="text-[11px] leading-snug text-fg-2">{e.message}</div>
      {e.detail && <div className="ig-mono mt-0.5 text-[10px] break-all text-dim">{e.detail}</div>}
    </div>
  );
}

export function ChallengeCard({ d, challenge }: { d: Decision; challenge: Challenge }) {
  const session = useStore((s) => s.session);
  const ui = useStore((s) => s.challengeUI[challenge.challenge_id]);
  const now = useServerNow(500);
  const [justification, setJustification] = useState("Reviewed forecast and supplier quote; surge order approved for the 72 h window.");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("Order exceeds what the operator intended; re-plan within budget.");

  const ev = challenge.review_findings.find((f) => f.evidence.authorized_usd !== undefined)?.evidence ?? {};
  const authorized = numEv(ev.authorized_usd);
  const requested = numEv(ev.requested_usd);
  const ceiling = numEv(ev.ceiling_usd);
  const busy = ui?.busy ?? null;
  const grant = ui?.grant ?? null;
  const status = challenge.status;
  const pending = status === "pending";
  const leftChallenge = challenge.expires_at - now;
  const leftGrant = grant ? grant.expires_at - now : 0;
  const approverLabel = `${challenge.required_approver.name} (${challenge.required_approver.title})`;
  const canTamper = typeof d.action.parameters.quantity === "number" || typeof d.action.parameters.beds === "number";

  const statusChip = (
    <span
      className={cx(
        "rounded-[2px] px-1.5 text-[9.5px] leading-[16px] font-semibold tracking-[0.12em] uppercase",
        pending && "bg-challenge/15 text-challenge",
        status === "approved" && "bg-ibm/20 text-ibm-2",
        status === "executed" && "bg-allow/15 text-allow",
        (status === "rejected" || status === "refused" || status === "expired") && "bg-block/15 text-block",
      )}
    >
      {status === "pending" ? "Pending review" : status}
    </span>
  );

  return (
    <section className="border-b border-line px-4 py-3">
      <div className="relative overflow-hidden rounded-[5px] border border-challenge/45 bg-[linear-gradient(180deg,rgba(255,188,92,0.09),rgba(255,188,92,0.02))]">
        <div className="flex items-center justify-between gap-2 border-b border-challenge/20 px-3 py-2">
          <span className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.06em] text-challenge">
            <ShieldQuestion size={14} /> SUPERVISOR REVIEW
          </span>
          {statusChip}
        </div>

        <div className="px-3 py-2.5">
          {authorized !== null && requested !== null ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[3px] bg-black/20 px-2 py-1.5">
                <div className="ig-label-sm">Operator authorised</div>
                <div className="ig-mono mt-0.5 text-[16px] text-fg">{money(authorized)}</div>
              </div>
              <div className="rounded-[3px] bg-black/20 px-2 py-1.5">
                <div className="ig-label-sm" style={{ color: "#FFBC5C" }}>
                  Agent proposed
                </div>
                <div className="ig-mono mt-0.5 text-[16px] text-challenge">
                  {money(requested)}
                  {authorized > 0 && <span className="ml-1.5 text-[11px] text-challenge/80">{(requested / authorized).toFixed(1)}×</span>}
                </div>
              </div>
            </div>
          ) : null}
          {ceiling !== null && <div className="mt-1.5 text-[10.5px] text-muted">Supervisor approval ceiling {money(ceiling)}; above it no approval path exists.</div>}

          <div className="mt-2.5">
            <div className="ig-label-sm mb-1">Policy requiring review</div>
            {challenge.review_findings.length ? (
              challenge.review_findings.map((f) => (
                <div key={f.code} className="text-[11px] leading-snug text-fg-2">
                  <span className="ig-mono mr-1.5 text-challenge">{f.code}</span>
                  {f.message}
                </div>
              ))
            ) : (
              <div className="ig-mono text-[11px] text-fg-2">{challenge.review_codes.join(", ")}</div>
            )}
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <div className="ig-label-sm mb-0.5">Required approver</div>
              <div className="text-fg">{challenge.required_approver.name}</div>
              <div className="text-[10.5px] text-muted">{challenge.required_approver.title}</div>
            </div>
            <div>
              <div className="ig-label-sm mb-0.5">Review window</div>
              <div className={cx("ig-mono text-[13px]", pending && leftChallenge < 60 ? "text-block" : "text-fg")}>{pending ? countdown(leftChallenge) : "closed"}</div>
              <div className="text-[10.5px] text-muted">separation of duties enforced</div>
            </div>
          </div>

          {/* ---------------- actions ---------------- */}
          {pending && session && (
            <div className="mt-3 flex flex-col gap-1.5">
              <input className="ig-input h-7 text-[11px]" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Justification (recorded in the audit log)" maxLength={500} />
              <button type="button" className="ig-btn ig-btn-challenge h-8 w-full text-[12px]" disabled={busy !== null} onClick={() => void approveChallenge(challenge, justification)}>
                {busy === "approve" ? <Spinner size={12} /> : <BadgeCheck size={14} />} Approve as {approverLabel}
              </button>
              {!rejectOpen ? (
                <button type="button" className="ig-btn ig-btn-ghost h-7 w-full text-[11.5px] text-muted hover:text-block" disabled={busy !== null} onClick={() => setRejectOpen(true)}>
                  <CircleSlash size={13} /> Reject
                </button>
              ) : (
                <div className="flex gap-1.5">
                  <input className="ig-input h-7 text-[11px]" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                  <button type="button" className="ig-btn ig-btn-block h-7 shrink-0 text-[11px]" disabled={busy !== null} onClick={() => void rejectChallenge(challenge, reason)}>
                    {busy === "reject" ? <Spinner size={11} /> : null} Reject
                  </button>
                </div>
              )}
            </div>
          )}

          {grant && (
            <div className="mt-3 rounded-[4px] border border-ibm/40 bg-ibm/[0.07] p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-ibm-2">
                  <KeyRound size={13} /> SINGLE-USE GRANT
                </span>
                <span className={cx("ig-mono text-[11px]", leftGrant > 0 ? "text-fg" : "text-block")}>{leftGrant > 0 ? `TTL ${countdown(leftGrant)}` : "expired"}</span>
              </div>
              <div className="ig-mono mt-1 text-[10.5px] text-fg-2">{grant.grant_id}</div>
              <div className="ig-mono mt-0.5 truncate text-[9.5px] text-dim" title="HMAC-signed grant token, bound to this action fingerprint">
                {grant.grant.slice(0, 44)}…
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {!ui?.executed && status !== "executed" && (
                  <button type="button" className="ig-btn ig-btn-allow h-8 w-full text-[12px]" disabled={busy !== null || leftGrant <= 0} onClick={() => void executeWithGrant(challenge, "execute")}>
                    {busy === "execute" ? <Spinner size={12} /> : <Play size={13} />} Execute with approval
                  </button>
                )}
                <div className="ig-label-sm mt-0.5">Security tests (real server responses)</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    className="ig-btn h-7 text-[11px]"
                    disabled={busy !== null || !(ui?.executed || status === "executed")}
                    title="Call execute again with the same, already-used grant"
                    onClick={() => void executeWithGrant(challenge, "replay")}
                  >
                    {busy === "replay" ? <Spinner size={11} /> : <Repeat size={12} />} Replay approval
                  </button>
                  <button
                    type="button"
                    className="ig-btn h-7 text-[11px]"
                    disabled={busy !== null || !canTamper}
                    title="Submit a modified copy (quantity +200, total recomputed) and try to execute it with this grant"
                    onClick={() => void tamperAndReuse(challenge, d)}
                  >
                    {busy === "tamper" ? <Spinner size={11} /> : <Wrench size={12} />} Tamper &amp; reuse
                  </button>
                </div>
              </div>
            </div>
          )}

          {!grant && status === "approved" && (
            <div className="mt-3 text-[11px] leading-snug text-muted">
              Approved by {challenge.approved_by ?? "the supervisor"}. The single-use grant token is held only by the approving console session.
            </div>
          )}
          {status === "executed" && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-medium text-allow">
              <BadgeCheck size={14} /> Executed after supervisor approval and hard-policy re-validation.
            </div>
          )}
          {(status === "rejected" || status === "refused" || status === "expired") && (
            <div className="mt-2.5 text-[11.5px] font-medium text-block">
              {status === "rejected" ? "Rejected by the supervisor; the action will never execute." : status === "refused" ? "Execution refused: conditions changed since approval." : "Review window expired."}
            </div>
          )}

          {ui && ui.log.length > 0 && (
            <div className="mt-3 rounded-[4px] border border-line bg-black/30 px-2 py-1">
              <div className="ig-label-sm py-1">Server responses</div>
              {ui.log.map((e, i) => (
                <LogLine key={`${e.at}-${i}`} e={e} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
