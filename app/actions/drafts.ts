"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { regenerateDraftFor } from "@/lib/drafts/regenerate";
import { guardLlmBudget } from "@/lib/limits/rate-limit";

export async function regenerateDraft(commitmentId: string) {
  const db = await getServerClient();
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to write a draft.");

  const refused = await guardLlmBudget(db, orgId, "regenerate_draft");
  if (refused) return refused;

  await regenerateDraftFor(db, { commitmentId });
  revalidatePath(`/queue/${commitmentId}`);
}
