"use server";
import { getServerClient } from "@/lib/db/server";
import { validateSignup } from "@/lib/waitlist/signup";

/**
 * Returned rather than thrown, like the other actions that speak to a person: Next redacts
 * the message of an error thrown out of a Server Action in a production build.
 */
export type SignupResult = { ok: true } | { ok: false; error: string };

export async function joinWaitlist(formData: FormData): Promise<SignupResult> {
  const validated = validateSignup({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    company: String(formData.get("company") ?? ""),
  });
  // The honeypot returns an empty message, which the form shows as the ordinary
  // confirmation. Nothing is written.
  if (!validated.ok) return validated.error ? validated : { ok: true };

  const db = await getServerClient();
  const { error } = await db.from("waitlist_signup").insert({
    name: validated.name, email: validated.email, source: "waitlist",
  });

  if (error) {
    // 23505 is the case-insensitive unique index. Answering "you are already on the list"
    // would turn this form into a way to ask whether an address is on it, so a repeat
    // signup gets the same confirmation as a new one.
    if (error.code === "23505") return { ok: true };
    return { ok: false, error: "We could not save that just now. Try again in a moment." };
  }
  return { ok: true };
}
