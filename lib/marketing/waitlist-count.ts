import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import { WAITLIST_OFFSITE } from "@/lib/marketing/proof";

/**
 * How many people are on the waitlist, for the figure the home page states as fact.
 *
 * Counted through `waitlist_count()` rather than by selecting rows, because nothing may
 * read waitlist_signup — see 0014. The anon key can call the function and learn a number,
 * and that is all it can learn.
 *
 * Never throws. A marketing page that 500s because Postgres hiccuped is a worse outcome
 * than a page showing only the signups this site did not collect, so a failure falls back
 * to the off-site figure and says nothing about it.
 *
 * Built with a bare anon client rather than `getServerClient()` on purpose: that one reads
 * cookies, and a route that reads cookies cannot be statically rendered. Using it here
 * turned both marketing pages from ISR into per-request server renders. The count is the
 * same number for everyone, signed in or not, so there is nothing for a session to say.
 */
export async function waitlistCount(): Promise<number> {
  try {
    const db = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { auth: { persistSession: false } },
    );
    const { data, error } = await db.rpc("waitlist_count");
    if (error || typeof data !== "number") return WAITLIST_OFFSITE;
    return WAITLIST_OFFSITE + data;
  } catch {
    return WAITLIST_OFFSITE;
  }
}
