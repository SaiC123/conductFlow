"use server";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { redirect } from "next/navigation";

const DEMO_EMAIL = "owner@demo.test";

/**
 * Dev-only session for the seeded demo owner. No password field exists anywhere:
 * the session is minted through the admin API and exchanged for cookies.
 * Google OAuth replaces this in Phase 3.
 */
export async function signInAsDemoOwner() {
  if (process.env.NODE_ENV === "production") throw new Error("dev sign-in disabled");
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
