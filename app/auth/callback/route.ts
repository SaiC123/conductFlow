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
  //
  // Guarded because this is the one step that used to fail as a bare 500: a misconfigured
  // service-role key threw inside the Supabase client, the function crashed, and the browser
  // showed its own error page with nothing to read. Every other failure on this route lands
  // on /onboarding with a reason, and this one should too.
  try {
    await bootstrapUser(getServiceClient(), {
      id: auth.user.id,
      email: auth.user.email ?? `${auth.user.id}@unknown.invalid`,
      fullName: (auth.user.user_metadata?.full_name as string | undefined) ?? null,
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "workspace_setup_failed";
    console.error("bootstrapUser failed after a successful sign-in", cause);
    return NextResponse.redirect(
      new URL(`/onboarding?error=${encodeURIComponent(reason)}`, url.origin));
  }

  return NextResponse.redirect(new URL("/queue", url.origin));
}
