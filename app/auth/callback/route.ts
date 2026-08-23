import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { bootstrapUser } from "@/lib/auth/bootstrap";
import { safeNextPath } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

/** Where Google returns after sign-in. Exchanges the code, then makes sure the user has an org. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const next = safeNextPath(url.searchParams.get("next"));

  /*
   * The one case where a first sign-in must not create a workspace.
   *
   * bootstrapUser exists so that nobody lands in an empty app with no way out, and for
   * everybody arriving on their own that is right. Somebody arriving on an invitation is the
   * exception: give them their own organization here and they now belong to one, and
   * acceptInvite refuses a second — so the invitation they came to accept would fail, on a
   * workspace created three seconds earlier by us. They are heading to a screen that will
   * make them a member of a real organization; that screen is where the org comes from.
   *
   * If the invitation turns out to be dead, /invite tells them to sign in again without it,
   * which lands here with no `next` and bootstraps them normally.
   */
  const joiningAnOrg = next?.startsWith("/invite/") ?? false;

  const onwards = (path: string) => {
    const target = new URL(path, url.origin);
    if (next) target.searchParams.set("next", next);
    return NextResponse.redirect(target);
  };

  if (oauthError || !code) {
    const reason = oauthError ?? "no_code";
    return onwards(`/onboarding?error=${encodeURIComponent(reason)}`);
  }

  const db = await getServerClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) {
    return onwards(`/onboarding?error=${encodeURIComponent(error.message)}`);
  }

  const { data: auth } = await db.auth.getUser();
  if (!auth.user) {
    return onwards("/onboarding?error=no_session");
  }

  // Service role: creating an organization is a server decision, and `organization` is not
  // granted to `authenticated`.
  //
  // Guarded because this is the one step that used to fail as a bare 500: a misconfigured
  // service-role key threw inside the Supabase client, the function crashed, and the browser
  // showed its own error page with nothing to read. Every other failure on this route lands
  // on /onboarding with a reason, and this one should too.
  try {
    if (!joiningAnOrg) {
      await bootstrapUser(getServiceClient(), {
        id: auth.user.id,
        email: auth.user.email ?? `${auth.user.id}@unknown.invalid`,
        fullName: (auth.user.user_metadata?.full_name as string | undefined) ?? null,
      });
    }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "workspace_setup_failed";
    console.error("bootstrapUser failed after a successful sign-in", cause);
    return onwards(`/onboarding?error=${encodeURIComponent(reason)}`);
  }

  return NextResponse.redirect(new URL(next ?? "/queue", url.origin));
}
