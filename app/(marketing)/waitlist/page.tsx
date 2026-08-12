import Link from "next/link";
import { WaitlistHero } from "@/components/waitlist/WaitlistHero";
import { waitlistCount } from "@/lib/marketing/waitlist-count";

export const metadata = {
  title: "Early access — ConductFlow",
  description: "Join the waitlist for ConductFlow early access.",
};

/**
 * Rebuilt at most once a minute rather than on every request: the count is the only thing
 * on the page that moves, and a marketing page should still be a static file for the other
 * fifty-nine seconds.
 */
export const revalidate = 60;

/**
 * The same hero the home page opens with, on its own and with nothing under it. Kept as a
 * route so a link that promises only a signup delivers only a signup.
 */
export default async function WaitlistPage() {
  return (
    <main>
      <WaitlistHero
        signupCount={await waitlistCount()}
        footer={
          <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)" }}>
            Already know what it does? <Link href="/">Read the case for it.</Link>
          </p>
        }
      />
    </main>
  );
}
