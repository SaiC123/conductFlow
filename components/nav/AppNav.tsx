"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";

export interface NavItem {
  href: string;
  label: string;
  isCurrent: boolean;
}

const DESTINATIONS: { href: string; label: string }[] = [
  { href: "/queue", label: "Queue" },
  { href: "/tasks", label: "Tasks" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/operations", label: "Operations" },
  { href: "/settings", label: "Settings" },
];

/**
 * Pure so it can be tested without a DOM. A nested route marks its parent current:
 * reviewing a draft at /queue/<id> is still being in the queue.
 */
export function navItems(pathname: string): NavItem[] {
  return DESTINATIONS.map((d) => ({
    ...d,
    isCurrent: pathname === d.href || pathname.startsWith(`${d.href}/`),
  }));
}

/**
 * Ingest is a primary action, not a destination, so it sits apart from the four links and
 * is styled as a button. Leaving it out entirely was the other option, but then an owner
 * standing on /tasks or /dashboard has no way to add a conversation without going back to
 * the queue first — and adding a conversation is the one thing the product exists to start.
 */
export function AppNav({ email }: { email: string | null }) {
  const pathname = usePathname() ?? "";
  const items = navItems(pathname);

  return (
    <nav aria-label="Main" style={{ borderBottom: "1px solid var(--border)",
      background: "var(--surface)" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "0 24px", display: "flex",
        alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 52 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 24, minWidth: 0 }}>
          <Link href="/queue" style={{ color: "var(--text)", textDecoration: "none",
            fontWeight: 600, fontSize: 14, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
            ConductFlow
          </Link>

          <ul style={{ display: "flex", listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={item.isCurrent ? "page" : undefined}
                  style={{
                    display: "block", padding: "16px 10px 14px", fontSize: 13,
                    textDecoration: "none", whiteSpace: "nowrap",
                    color: item.isCurrent ? "var(--text)" : "var(--muted)",
                    // Weight and the underline carry the state as well as colour does,
                    // so it survives a monochrome screen or a colour-blind reader.
                    fontWeight: item.isCurrent ? 600 : 400,
                    borderBottom: item.isCurrent
                      ? "2px solid var(--accent)" : "2px solid transparent",
                  }}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Link href="/ingest" style={{ background: "var(--accent)", color: "#fff",
            padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            textDecoration: "none", whiteSpace: "nowrap" }}>
            Add transcript
          </Link>
          {email && (
            <span className="mono" title={email} style={{ color: "var(--muted)", fontSize: 12,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              maxWidth: 180 }}>
              {email}
            </span>
          )}
          <SignOutButton />
        </div>
      </div>
    </nav>
  );
}
