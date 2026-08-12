"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";
import { buttonStyle } from "@/components/ui/primitives";

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
    // Sticky, and sharing the page frame's width and gutter, so the wordmark sits directly
    // above the first character of every screen's heading.
    <nav aria-label="Main" className="cf-nav">
      <div style={{ maxWidth: "var(--shell)", margin: "0 auto", padding: "0 var(--gutter)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "var(--space-4)", minHeight: 48 }}>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", minWidth: 0 }}>
          <Link href="/queue" style={{ color: "var(--text)", fontWeight: 600,
            fontSize: "var(--text-base)", letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
            ConductFlow
          </Link>

          <ul style={{ display: "flex", listStyle: "none", padding: 0, margin: 0, gap: 1 }}>
            {items.map((item) => (
              <li key={item.href}>
                {/*
                  The skin lives in globals.css keyed off aria-current, so the pill an eye
                  sees and the state a screen reader hears cannot drift apart. Weight and
                  fill carry it as well as colour does, for a monochrome screen.
                */}
                <Link href={item.href} className="cf-nav-link"
                  aria-current={item.isCurrent ? "page" : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
          <Link href="/ingest" className="cf-btn"
            style={{ ...buttonStyle("primary"), color: "#fff", height: 28,
              fontSize: "var(--text-sm)" }}>
            Add transcript
          </Link>
          {email && (
            <span className="mono" title={email} style={{ color: "var(--faint)",
              fontSize: "var(--text-xs)", paddingInline: "var(--space-2)",
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
