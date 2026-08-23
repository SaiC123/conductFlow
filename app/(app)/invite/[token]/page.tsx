import Link from "next/link";
import { headers } from "next/headers";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { clientAddress, subjectFor } from "@/lib/limits/anon-rate-limit";
import { guardRedemptionBudget } from "@/lib/limits/invite-limit";
import { previewInvite } from "@/lib/orgs/accept";
import { AcceptInvite } from "@/components/orgs/AcceptInvite";
import { Card, CardTitle, buttonStyle, fieldStyle, labelStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/** The same narrow column onboarding uses: this is the same moment, from the other side. */
const column: React.CSSProperties = {
  maxWidth: 440, margin: "0 auto", padding: "var(--space-7) var(--gutter)",
};

function Refusal({ message }: { message: string }) {
  return (
    <main style={column}>
      <Card tone="danger">
        <CardTitle tone="danger" dot>That invitation cannot be used</CardTitle>
        <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", lineHeight: 1.55 }}>
          {message}
        </p>
      </Card>
      <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
        marginTop: "var(--space-5)", lineHeight: 1.5 }}>
        If you meant to set up a workspace of your own instead,{" "}
        <Link href="/onboarding" style={{ color: "var(--accent-text)" }}>start here</Link>.
      </p>
    </main>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Rate limited on the way in, not only on the way through. Reading a link is the cheap half
  // of guessing one: without this, an attacker learns which tokens name a real organization by
  // opening pages, and never has to press a button. Keyed on the address, because whoever is
  // holding a link is by definition nobody the database knows yet.
  const service = getServiceClient();
  const refused = await guardRedemptionBudget(
    service, subjectFor(clientAddress(await headers())));
  if (refused) return <Refusal message={refused.error} />;

  const preview = await previewInvite(service, token);
  if (!preview.ok) return <Refusal message={preview.error} />;

  const db = await getServerClient();
  const { data: auth } = await db.auth.getUser();

  if (auth.user) {
    return (
      <main style={column}>
        <p className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)",
          letterSpacing: "0.08em", textTransform: "uppercase" }}>
          You have been invited
        </p>
        <h1 style={{ fontSize: "var(--text-xl)", marginTop: "var(--space-3)",
          marginBottom: "var(--space-5)" }}>
          {preview.preview.orgName}
        </h1>
        <AcceptInvite
          token={token}
          orgName={preview.preview.orgName}
          role={preview.preview.role}
          signedInAs={auth.user.email ?? "this account"}
        />
        <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
          marginTop: "var(--space-5)", lineHeight: 1.5 }}>
          An invitation only works for the address it was sent to. If that is not the account
          above, sign out and sign back in with the right one.
        </p>
      </main>
    );
  }

  // Both forms carry the way back here, so signing in finishes on the invitation rather than
  // dropping somebody into a workspace they have not joined.
  const next = `/invite/${encodeURIComponent(token)}`;

  return (
    <main style={column}>
      <p className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)",
        letterSpacing: "0.08em", textTransform: "uppercase" }}>
        You have been invited
      </p>
      <h1 style={{ fontSize: "var(--text-xl)", marginTop: "var(--space-3)" }}>
        Join {preview.preview.orgName}
      </h1>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", lineHeight: 1.6 }}>
        Sign in with the address this invitation was sent to, and you will join as{" "}
        {preview.preview.role === "owner" ? "an owner" : "a member"}. We never ask for a
        password.
      </p>

      <form action="/auth/signin" method="get">
        <input type="hidden" name="next" value={next} />
        <button type="submit" style={{
          ...buttonStyle("secondary"),
          background: "#fff", color: "#111", borderColor: "#fff", fontWeight: 600,
          width: "100%", height: 36, marginTop: "var(--space-5)",
        }}>
          Continue with Google
        </button>
      </form>

      <form action="/auth/email" method="post">
        <input type="hidden" name="next" value={next} />
        <label style={labelStyle}>
          Or have a link emailed to you
          <input name="email" type="email" required autoComplete="email"
            placeholder="you@yourcompany.com" style={fieldStyle} />
        </label>
        <button type="submit" style={{ ...buttonStyle("secondary"), width: "100%",
          height: 36, marginTop: "var(--space-3)" }}>
          Email me a sign-in link
        </button>
      </form>

      <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
        marginTop: "var(--space-6)", lineHeight: 1.5 }}>
        This link works once and expires. Signing in does not join you to anything on its own —
        there is a confirmation after it.
      </p>
    </main>
  );
}
