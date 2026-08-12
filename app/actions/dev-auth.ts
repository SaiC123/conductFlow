"use server";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { redirect } from "next/navigation";

const DEMO_EMAIL = "owner@demo.test";

/** A hosted Supabase URL means this is not a local stack, whatever NODE_ENV claims. */
function pointsAtLocalStack(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(url);
}

/**
 * Dev-only session for the seeded demo owner. No password field exists anywhere:
 * the session is minted through the admin API and exchanged for cookies.
 *
 * Google sign-in (app/actions/auth.ts) is the real path now; this survives so local work
 * needs no Google client. Two gates, because NODE_ENV alone is one typo from minting a
 * real session against the hosted project: the build must be non-production AND the
 * Supabase URL must be loopback.
 */
export async function signInAsDemoOwner() {
  if (process.env.NODE_ENV === "production") throw new Error("dev sign-in disabled");
  if (!pointsAtLocalStack())
    throw new Error("dev sign-in refuses to run against a non-local Supabase project");
  const { data, error } = await getServiceClient().auth.admin.generateLink({
    type: "magiclink", email: DEMO_EMAIL,
  });
  if (error || !data.properties?.hashed_token) throw error ?? new Error("no token");
  const s = await getServerClient();
  const { error: verifyError } = await s.auth.verifyOtp({
    type: "email", token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw verifyError;
  redirect("/queue");
}

export async function signOut() {
  const s = await getServerClient();
  await s.auth.signOut();
  redirect("/onboarding");
}
