import Link from "next/link";
import { buttonStyle } from "@/components/ui/primitives";
import { HARD_PROHIBITED } from "@/lib/agent/blueprint";

/**
 * The landing page's job is one sentence an owner recognises, the actual loop, and the
 * boundary the product is sold on. No testimonials, logos, or metrics: none exist yet,
 * and inventing them on a page a real customer reads would be a lie.
 */

const STAGES = [
  {
    n: "01",
    title: "The conversation happens",
    body: "Paste your notes, or upload the transcript from the call. A tutoring check-in, a client review, a discovery call.",
  },
  {
    n: "02",
    title: "Every promise gets pulled out",
    body: "Who owes what, by when — each one carrying the exact words from the conversation it came from, so you can check it in a second.",
  },
  {
    n: "03",
    title: "You decide",
    body: "Nothing moves until you say so. Approve the ones that are right, discard the ones that aren't, edit the draft it wrote in your voice.",
    halt: true,
  },
  {
    n: "04",
    title: "It gets followed through",
    body: "Approved promises become tasks. If the date passes and it isn't done, you hear about it — before the client does.",
  },
];

/** Plain English for the limits enforced in code, not in settings. */
const NEVER: Record<string, string> = {
  send_external_email: "Send an email to anyone",
  change_scope: "Change what was agreed",
  change_pricing: "Change a price",
  sign_contract: "Sign anything",
  take_payment: "Take a payment",
  delete_record: "Delete a record",
};

const shell: React.CSSProperties = {
  maxWidth: 960, marginInline: "auto", paddingInline: "var(--space-5)",
};

export default function Home() {
  return (
    <>
      <header style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ ...shell, display: "flex", alignItems: "center",
          justifyContent: "space-between", minHeight: 56, gap: "var(--space-4)" }}>
          <span style={{ fontWeight: 600, fontSize: "var(--text-md)", letterSpacing: "-0.02em" }}>
            ConductFlow
          </span>
          <Link href="/onboarding" style={{ fontSize: "var(--text-base)" }}>Sign in →</Link>
        </div>
      </header>

      <main>
        {/* Atmosphere, not decoration: one soft field behind the hero so the page has a
            light source instead of reading as a flat sheet. */}
        <section style={{ position: "relative", overflow: "hidden",
          borderBottom: "1px solid var(--border)" }}>
          <div aria-hidden style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background:
              "radial-gradient(720px 320px at 12% -10%, var(--accent-quiet), transparent 70%)",
          }} />
          <div style={{ ...shell, position: "relative",
            paddingBlock: "var(--space-7)" }}>
            <p className="mono" style={{ color: "var(--accent)", fontSize: "var(--text-xs)",
              letterSpacing: "0.08em", textTransform: "uppercase" }}>
              For client-service teams of 2–20
            </p>
            <h1 style={{
              // Derived from the scale rather than a new raw size; the ops-tool cap of 30px
              // is deliberate inside the app, but a landing headline earns more room.
              fontSize: "clamp(var(--text-xl), 4.6vw, calc(var(--text-2xl) * 1.35))",
              letterSpacing: "-0.035em", lineHeight: 1.04,
              marginTop: "var(--space-4)", maxWidth: "22ch",
              // Explicit break, and the first line kept whole: at 16ch the measure was
              // narrower than the sentence, so "it." wrapped alone onto its own line.
              textWrap: "balance",
            }}>
              <span style={{ display: "block", whiteSpace: "nowrap" }}>
                You said you&apos;d send it.
              </span>
              ConductFlow makes sure you do.
            </h1>
            <p style={{ color: "var(--muted)", fontSize: "var(--text-md)", lineHeight: 1.6,
              marginTop: "var(--space-4)", maxWidth: "56ch" }}>
              After a client conversation, it finds every promise you made, drafts the follow-up
              in your words, and tracks it until it&apos;s delivered — so nothing quietly falls
              through the week.
            </p>
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center",
              flexWrap: "wrap", marginTop: "var(--space-6)" }}>
              <Link href="/onboarding" style={{ ...buttonStyle("primary"), color: "#fff",
                padding: "10px 18px" }}>
                Get started
              </Link>
              <span style={{ color: "var(--faint)", fontSize: "var(--text-sm)" }}>
                Sign in with Google. No password, no card.
              </span>
            </div>
          </div>
        </section>

        <section style={{ ...shell, paddingBlock: "var(--space-7)" }}>
          <h2 style={{ fontSize: "var(--text-lg)" }}>How it runs</h2>
          <ol style={{ listStyle: "none", padding: 0, margin: "var(--space-5) 0 0" }}>
            {STAGES.map((s, i) => (
              <li key={s.n} style={{
                display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--space-4)",
                alignItems: "start",
                paddingBlock: "var(--space-5)",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
              }}>
                <span className="mono" aria-hidden style={{
                  fontSize: "var(--text-sm)",
                  color: s.halt ? "var(--accent)" : "var(--faint)",
                  paddingTop: 2, width: "3ch",
                }}>
                  {s.n}
                </span>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)",
                    flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: "var(--text-md)" }}>{s.title}</h3>
                    {/* The one moment the flow deliberately stops. Marked in text, not
                        only in colour. */}
                    {s.halt && (
                      <span className="mono" style={{
                        fontSize: "var(--text-xs)", letterSpacing: "0.06em",
                        textTransform: "uppercase", color: "var(--accent)",
                        border: "1px solid var(--accent)", borderRadius: 999,
                        padding: "2px 8px", background: "var(--accent-quiet)",
                      }}>
                        Stops here for you
                      </span>
                    )}
                  </div>
                  <p style={{ color: "var(--muted)", marginTop: "var(--space-2)",
                    maxWidth: "62ch", lineHeight: 1.6 }}>
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section style={{ borderBlock: "1px solid var(--border)", background: "var(--surface)" }}>
          <div style={{ ...shell, paddingBlock: "var(--space-7)" }}>
            <h2 style={{ fontSize: "var(--text-lg)" }}>What it will never do</h2>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "62ch",
              lineHeight: 1.6 }}>
              Not a setting you have to remember to switch off. These limits are fixed in the
              product — there is no configuration, and no support ticket, that turns them on.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-5) 0 0",
              display: "grid", gap: "var(--space-2)",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              {HARD_PROHIBITED.map((action) => (
                <li key={action} style={{
                  display: "flex", alignItems: "baseline", gap: "var(--space-3)",
                  border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                  padding: "var(--space-3)", background: "var(--canvas)",
                }}>
                  <span aria-hidden className="mono" style={{ color: "var(--danger)",
                    fontSize: "var(--text-sm)" }}>✕</span>
                  <span>
                    {NEVER[action] ?? action}
                    <span className="mono" style={{ display: "block", color: "var(--faint)",
                      fontSize: "var(--text-xs)", marginTop: 2 }}>{action}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-5)", maxWidth: "62ch",
              lineHeight: 1.6 }}>
              Everything else is yours to decide, in a blueprint you can read and change: what the
              assistant does on its own, and what it has to ask you about first.
            </p>
          </div>
        </section>

        <section style={{ ...shell, paddingBlock: "var(--space-7)" }}>
          <h2 style={{ fontSize: "var(--text-lg)", maxWidth: "24ch" }}>
            Start with one conversation.
          </h2>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-3)", maxWidth: "56ch",
            lineHeight: 1.6 }}>
            Paste the notes from your last client call and see what it finds. Nothing is sent,
            and nothing is created until you approve it.
          </p>
          <Link href="/onboarding" style={{ ...buttonStyle("primary"), color: "#fff",
            padding: "10px 18px", marginTop: "var(--space-5)" }}>
            Get started
          </Link>
        </section>

        <footer style={{ borderTop: "1px solid var(--border)" }}>
          <div style={{ ...shell, paddingBlock: "var(--space-5)", color: "var(--faint)",
            fontSize: "var(--text-sm)" }}>
            ConductFlow — every client promise, tracked.
          </div>
        </footer>
      </main>
    </>
  );
}
