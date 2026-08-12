"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { regenerateDraftFor } from "@/lib/drafts/regenerate";

export async function regenerateDraft(commitmentId: string) {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to write a draft.");

  await regenerateDraftFor(db, { commitmentId });
  revalidatePath(`/queue/${commitmentId}`);
}
