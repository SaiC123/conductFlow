"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvitation, withdrawInvitation } from "@/app/actions/invites";
import { removeFromOrg, setMemberRole } from "@/app/actions/members";
import {
  Badge, Card, CardTitle, EmptyState, SectionHeading, buttonStyle, fieldStyle,
} from "@/components/ui/primitives";

export interface MemberView {
  userId: string;
  email: string;
  role: "owner" | "member";
  joinedAt: string;
}

export interface InviteView {
  id: string;
  email: string;
  role: "owner" | "member";
  expiresAt: string;
}

interface MemberListProps {
  members: MemberView[];
  invites: InviteView[];
  /** False for a member: they see who is here, and no control that would be refused. */
  canManage: boolean;
  currentUserId: string;
}

const ROLE_NOTE: Record<"owner" | "member", string> = {
  owner: "Can invite people, change roles, and set what the assistant may do.",
  member: "Can add conversations, approve promises, and work the board.",
};

function isoDay(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** The row layout every list on this screen shares, so people and invitations line up. */
const rowStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  gap: "var(--space-4)", flexWrap: "wrap",
  padding: "var(--space-3) 0", borderTop: "1px solid var(--border)",
};

export function MemberList({ members, invites, canManage, currentUserId }: MemberListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ link: string; email: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // An organization cannot be left without one, so the last one's controls are not offered.
  // The database refuses it either way — see the trigger in migration 0019 — but a button
  // whose only outcome is an error message is not a button.
  const owners = members.filter((m) => m.role === "owner").length;

  function run(id: string, work: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null); setBusyId(id);
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) setError(result.error);
        else router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That change did not stick.");
      } finally {
        setBusyId(null);
      }
    });
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright, and the link is on screen either way.
      setCopied(false);
    }
  }

  return (
    <>
      <SectionHeading note={`${members.length} ${members.length === 1 ? "person" : "people"}`}>
        People
      </SectionHeading>

      <Card>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {members.map((m) => {
            const isLastOwner = m.role === "owner" && owners === 1;
            const busy = isPending && busyId === m.userId;
            return (
              <li key={m.userId} style={{ ...rowStyle, borderTop: "1px solid var(--border)" }}
                aria-busy={busy}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.email}
                    {m.userId === currentUserId && (
                      <span style={{ color: "var(--faint)" }}> · you</span>
                    )}
                  </span>
                  <span className="mono" style={{ display: "block", color: "var(--faint)",
                    fontSize: "var(--text-xs)", marginTop: 2 }}>
                    joined {isoDay(m.joinedAt)}
                  </span>
                </span>

                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-3)",
                  flexShrink: 0 }}>
                  {canManage && !isLastOwner ? (
                    <label style={{ display: "flex", alignItems: "center",
                      gap: "var(--space-2)" }}>
                      <span className="mono" style={{ color: "var(--faint)",
                        fontSize: "var(--text-xs)" }}>role</span>
                      <select value={m.role} disabled={busy}
                        onChange={(e) => run(m.userId,
                          () => setMemberRole(m.userId, e.target.value))}
                        style={{ ...fieldStyle, width: "auto", marginTop: 0, height: 30,
                          padding: "0 8px" }}>
                        <option value="owner">Owner</option>
                        <option value="member">Member</option>
                      </select>
                    </label>
                  ) : (
                    <Badge tone={m.role === "owner" ? "accent" : "neutral"}
                      title={isLastOwner
                        ? "A workspace always has at least one owner. Make somebody else an owner first."
                        : ROLE_NOTE[m.role]}>
                      {m.role}
                    </Badge>
                  )}

                  {canManage && !isLastOwner && (
                    <button onClick={() => run(m.userId, () => removeFromOrg(m.userId))}
                      disabled={busy} aria-busy={busy}
                      style={{ ...buttonStyle("ghost", busy), minWidth: 84 }}>
                      {busy ? "Removing…" : "Remove"}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
          marginTop: "var(--space-3)", maxWidth: "62ch" }}>
          Removing somebody takes their access away and takes their name off any task they were
          holding. What they already did — approvals, delivered work, the audit trail — stays.
        </p>
      </Card>

      {canManage && (
        <>
          <div style={{ marginTop: "var(--space-7)" }}>
            <SectionHeading note={invites.length > 0 ? `${invites.length} outstanding` : undefined}>
              Invitations
            </SectionHeading>
          </div>

          <Card>
            <CardTitle>Invite somebody</CardTitle>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "58ch" }}>
              ConductFlow does not send the email — you get a link to pass on however you
              already talk to them. It works once, expires in a week, and only for the address
              you type here.
            </p>

            <form
              action={(fd) => {
                setError(null); setCopied(false); setIssued(null); setBusyId("new");
                startTransition(async () => {
                  try {
                    const result = await createInvitation(fd);
                    if (!result.ok) setError(result.error);
                    else {
                      setIssued(result);
                      router.refresh();
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "That invitation was refused.");
                  } finally {
                    setBusyId(null);
                  }
                });
              }}
              style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap",
                alignItems: "flex-end", marginTop: "var(--space-4)" }}
            >
              <label style={{ flex: "1 1 240px", minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "var(--text-sm)",
                  color: "var(--muted)" }}>Email address</span>
                <input name="email" type="email" required autoComplete="off"
                  placeholder="colleague@yourcompany.com" style={fieldStyle} />
              </label>
              <label>
                <span style={{ display: "block", fontSize: "var(--text-sm)",
                  color: "var(--muted)" }}>Join as</span>
                <select name="role" defaultValue="member"
                  style={{ ...fieldStyle, width: "auto", height: 32 }}>
                  <option value="member">Member</option>
                  <option value="owner">Owner</option>
                </select>
              </label>
              <button type="submit" disabled={isPending && busyId === "new"}
                aria-busy={isPending && busyId === "new"}
                style={{ ...buttonStyle("primary", isPending && busyId === "new"),
                  height: 32, minWidth: 132 }}>
                {isPending && busyId === "new" ? "Creating…" : "Create a link"}
              </button>
            </form>

            {issued && (
              <div style={{ marginTop: "var(--space-4)" }}>
                <Card tone="ok">
                  <CardTitle tone="ok" dot>Link for {issued.email}</CardTitle>
                  <p style={{ color: "var(--muted)", marginTop: "var(--space-2)",
                    maxWidth: "58ch" }}>
                    Send this to them now. It is shown once — ConductFlow keeps only a
                    fingerprint of it and cannot show it again. Expires {isoDay(issued.expiresAt)}.
                  </p>
                  <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap",
                    alignItems: "center", marginTop: "var(--space-3)" }}>
                    <code className="mono" style={{ flex: "1 1 280px", minWidth: 0,
                      background: "var(--canvas)", border: "1px solid var(--border-strong)",
                      borderRadius: "var(--radius-sm)", padding: "7px 10px",
                      fontSize: "var(--text-sm)", wordBreak: "break-all" }}>
                      {issued.link}
                    </code>
                    <button onClick={() => copy(issued.link)}
                      style={{ ...buttonStyle("secondary"), minWidth: 84 }}>
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <button onClick={() => { setIssued(null); setCopied(false); }}
                      style={buttonStyle("ghost")}>
                      Done
                    </button>
                  </div>
                </Card>
              </div>
            )}

            <div style={{ marginTop: "var(--space-5)" }}>
              {invites.length === 0 ? (
                <EmptyState
                  title="Nothing outstanding"
                  body="Every link you create appears here until it is used, withdrawn, or expires — so you can always see who could still walk in."
                />
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {invites.map((invite) => {
                    const busy = isPending && busyId === invite.id;
                    return (
                      <li key={invite.id} style={rowStyle} aria-busy={busy}>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {invite.email}
                          </span>
                          <span className="mono" style={{ display: "block",
                            color: "var(--faint)", fontSize: "var(--text-xs)", marginTop: 2 }}>
                            expires {isoDay(invite.expiresAt)}
                          </span>
                        </span>
                        <span style={{ display: "flex", alignItems: "center",
                          gap: "var(--space-3)", flexShrink: 0 }}>
                          <Badge tone={invite.role === "owner" ? "accent" : "neutral"}>
                            as {invite.role}
                          </Badge>
                          <button onClick={() => run(invite.id,
                            () => withdrawInvitation(invite.id))}
                            disabled={busy} aria-busy={busy}
                            style={{ ...buttonStyle("ghost", busy), minWidth: 92 }}>
                            {busy ? "Withdrawing…" : "Withdraw"}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-4)",
          maxWidth: "62ch" }}>
          {error}
        </p>
      )}
    </>
  );
}
