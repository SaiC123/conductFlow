import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { bootstrapUser } from "@/lib/auth/bootstrap";

export const dynamic = "force-dynamic";

/** Where Google returns after sign-in. Exchanges the code, then makes sure the user has an org. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  if (oauthError || !code) {
    const reason = oauthError ?? "no_code";
    return NextResponse.redirect(new URL(`/onboarding?error=${encodeURIComponent(reason)}`, url.origin));
  }

  const db = await getServerClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/onboarding?error=${encodeURIComponent(error.message)}`, url.origin));
  }

  const { data: auth } = await db.auth.getUser();
  if (!auth.user) {
    return NextResponse.redirect(new URL("/onboarding?error=no_session", url.origin));
  }

  // Service role: creating an organization is a server decision, and `organization` is not
  // granted to `authenticated`.
  await bootstrapUser(getServiceClient(), {
    id: auth.user.id,
    email: auth.user.email ?? `${auth.user.id}@unknown.invalid`,
    fullName: (auth.user.user_metadata?.full_name as string | undefined) ?? null,
  });

  return NextResponse.redirect(new URL("/queue", url.origin));
}
