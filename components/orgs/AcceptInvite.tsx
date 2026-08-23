"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvitation } from "@/app/actions/invites";
import { Card, CardTitle, buttonStyle } from "@/components/ui/primitives";

/**
 * The one button on the invitation screen.
 *
 * Acceptance is a click rather than something that happens on load, deliberately: an
 * invitation is a single-use credential, and a page that spent it merely by being opened would
 * be spent by a link preview, a mail scanner, or a stray refresh before its recipient ever saw
 * it. So the token is redeemed when a person says so.
 */
export function AcceptInvite({ token, orgName, role, signedInAs }: {
  token: string; orgName: string; role: string; signedInAs: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await acceptInvitation(token);
        if (!result.ok) setError(result.error);
        else router.push("/queue");
      } catch (e) {
        setError(e instanceof Error ? e.message : "That invitation could not be accepted.");
      }
    });
  }

  return (
    <Card>
      <CardTitle>Join {orgName}</CardTitle>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", lineHeight: 1.55 }}>
        You will join as {role === "owner" ? "an owner" : "a member"}, signed in as{" "}
        <span className="mono" style={{ color: "var(--text)", wordBreak: "break-word" }}>
          {signedInAs}
        </span>. Accepting gives you access to this workspace&rsquo;s conversations, promises,
        and drafts.
      </p>

      <button onClick={accept} disabled={isPending} aria-busy={isPending}
        style={{ ...buttonStyle("primary", isPending), width: "100%", height: 36,
          marginTop: "var(--space-5)" }}>
        {isPending ? "Joining…" : `Join ${orgName}`}
      </button>

      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-4)",
          lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </Card>
  );
}
