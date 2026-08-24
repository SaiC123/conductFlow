"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { regenerateDraftFor } from "@/lib/drafts/regenerate";
import { guardLlmBudget } from "@/lib/limits/rate-limit";
import { reportable } from "@/lib/actions/result";

export async function regenerateDraft(commitmentId: string) {
  return reportable("regenerateDraft", async () => {
    const db = await getServerClient();
    const orgId = await getCurrentOrgId();
    if (!orgId) throw new Error("Sign in to write a draft.");

    const refused = await guardLlmBudget(db, orgId, "regenerate_draft");
    if (refused) return refused;

    // Everything past here used to throw: "commitment not found", "action denied: …", and
    // above all UpstreamRateLimited, whose message names the one thing an owner can do
    // about it — wait a minute. The sibling ingest action already returned that sentence
    // while this one redacted it, so the same failure read correctly on one screen and not
    // on the other.
    await regenerateDraftFor(db, { commitmentId });
    revalidatePath(`/queue/${commitmentId}`);
  });
}
