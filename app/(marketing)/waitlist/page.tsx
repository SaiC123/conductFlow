import Link from "next/link";
import { WaitlistHero } from "@/components/waitlist/WaitlistHero";

export const metadata = {
  title: "Early access — ConductFlow",
  description: "Join the waitlist for ConductFlow early access.",
};

/**
 * The same hero the home page opens with, on its own and with nothing under it. Kept as a
 * route so a link that promises only a signup delivers only a signup.
 */
export default function WaitlistPage() {
  return (
    <main>
      <WaitlistHero
        footer={
          <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)" }}>
            Already know what it does? <Link href="/">Read the case for it.</Link>
          </p>
        }
      />
    </main>
  );
}
