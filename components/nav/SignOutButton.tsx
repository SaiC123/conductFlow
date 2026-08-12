"use client";
import { useTransition } from "react";
import { signOut } from "@/app/actions/auth";

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <form action={() => startTransition(async () => { await signOut(); })}>
      <button type="submit" disabled={isPending}
        style={{ background: "transparent", color: "var(--muted)",
          border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px",
          fontSize: 12, opacity: isPending ? 0.6 : 1,
          cursor: isPending ? "not-allowed" : "pointer" }}>
        {isPending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}
