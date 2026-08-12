import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getServerClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (written) => {
          try {
            written.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Next.js forbids writing cookies while rendering. Supabase calls this when it
            // refreshes an expiring session, which happens on any page or layout that reads
            // the user — so swallowing it here is the documented pattern, not a shortcut.
            // The refreshed session still applies to this request; it just is not persisted
            // until the next Server Action or Route Handler writes it.
          }
        },
      },
    }
  );
}
