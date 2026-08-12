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
      <AppNav email={email} />
      {/* The pages own their <main>; this wrapper is only a landmark id, so a skip link
          can be added once there is a stylesheet that can reveal it on focus. */}
      <div id="main">{children}</div>
    </>
  );
}
