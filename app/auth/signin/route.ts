import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SIGN_IN_SCOPES } from "@/lib/google/scopes";
import { requireEnv } from "@/lib/env";
import { safeNextPath, siteOrigin } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

/**
 * Starts Google sign-in. This is a Route Handler rather than a Server Action because
 * `signInWithOAuth` writes the PKCE code verifier as a cookie and then we leave for
 * accounts.google.com: a Server Action redirecting to an external origin does not reliably
 * flush Set-Cookie, so the verifier never reached the browser and the callback failed with
 * "no valid flow state found". Here the cookies are collected and written onto the 302 itself.
 */
export async function GET(request: Request) {
  const store = await cookies();
  const pending: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const db = createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (written) => {
          pending.push(...(written as typeof pending));
        },
      },
    }
  );

  const origin = await siteOrigin();
  // Where to land afterwards, when it is not the queue. Carried on the callback URL rather
  // than in a cookie of our own, because the callback is the only thing Google will return
  // to and it is already ours. Validated on both ends: see safeNextPath.
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));
  const callback = next
    ? `${origin}/auth/callback?next=${encodeURIComponent(next)}`
    : `${origin}/auth/callback`;

  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback,
      // Identity only. API access is asked for later, one capability at a time.
      scopes: SIGN_IN_SCOPES,
    },
  });

  if (error || !data.url) {
    const reason = error?.message ?? "no_authorize_url";
    return NextResponse.redirect(
      new URL(`/onboarding?error=${encodeURIComponent(reason)}`, origin)
    );
  }

  const response = NextResponse.redirect(data.url);
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }
  return response;
}
