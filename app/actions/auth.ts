"use server";
import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/db/server";

// Sign-in lives in app/auth/signin/route.ts, not here — see the note there on why a Server
// Action cannot carry the PKCE verifier cookie across an external redirect.

export async function signOut() {
  const db = await getServerClient();
  await db.auth.signOut();
  redirect("/onboarding");
}
