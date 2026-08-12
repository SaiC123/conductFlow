"use client";
import { useTransition } from "react";
import { signOut } from "@/app/actions/auth";
import { buttonStyle } from "@/components/ui/primitives";

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <form action={() => startTransition(async () => { await signOut(); })}>
      <button type="submit" disabled={isPending}
        style={{ ...buttonStyle("ghost", isPending), fontSize: "var(--text-sm)",
          padding: "5px 10px" }}>
        {isPending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}
