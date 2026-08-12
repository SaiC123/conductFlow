import { getServerClient } from "@/lib/db/server";
import { AppNav } from "@/components/nav/AppNav";

/** Reading the session needs cookies, so this group never prerenders. */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  const email = data.user?.email ?? null;

  // Signed out, every link would land on a "sign in" stub, so the nav stays away entirely
  // and /onboarding keeps the page to itself.
  if (!email) return <>{children}</>;

  return (
    <>
      {/* Off-screen until it is focused, which is the whole point: a keyboard user should
          not have to tab through five destinations to reach the queue. */}
      <a href="#main" className="skip-link">Skip to content</a>
      <AppNav email={email} />
      {/* The pages own their <main>; this wrapper is the skip link's target, and takes
          tabIndex so the browser will actually move focus into it. */}
      <div id="main" tabIndex={-1} style={{ outline: "none" }}>{children}</div>
    </>
  );
}
