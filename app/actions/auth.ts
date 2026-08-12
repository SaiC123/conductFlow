"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerClient } from "@/lib/db/server";
import { SIGN_IN_SCOPES } from "@/lib/google/scopes";

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signInWithGoogle() {
  const db = await getServerClient();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${await siteOrigin()}/auth/callback`,
      // Identity only. API access is asked for later, one capability at a time.
      scopes: SIGN_IN_SCOPES,
    },
  });
  if (error) throw new Error(`Google sign-in is unavailable: ${error.message}`);
  redirect(data.url);
}

export async function signOut() {
  const db = await getServerClient();
  await db.auth.signOut();
  redirect("/onboarding");
}
