"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId, loadOperationsData } from "@/lib/db/queries";
import { detectRecurring } from "@/lib/ops/recurring";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

/**
 * Turns a detected pattern into a proposed commitment in the review queue.
 *
 * Deliberately not a task: a predicted promise has not been made to anyone yet, so it
 * enters where every other unreviewed promise enters and gets approved the same way. The
 * click is the approval — which is why `approved` is true here and the blueprint decides
 * whether the action is available at all.
 */
export async function proposeRecurring(patternKey: string) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to add a suggestion.");
  const db = await getServerClient();

  const decision = canExecute("propose_recurring_task", true, await contractFor(db, orgId));
  if (!decision.ok) {
    throw new Error(decision.reason === "needs_approval"
      ? "That needs approval first."
      : "Your blueprint does not allow recurring suggestions.");
  }

  const data = await loadOperationsData(orgId);
  const pattern = detectRecurring(data, new Date()).find((p) => p.key === patternKey);
  if (!pattern) throw new Error("That pattern is no longer in the data.");

  // Provenance: this promise came from a pattern, not from a transcript, and the record
  // should say so rather than implying somebody said it out loud.
  const { data: conversation, error: convError } = await db.from("conversation").insert({
    org_id: orgId, client_id: pattern.clientId,
    title: `Predicted — ${pattern.cadence} follow-up`,
    occurred_at: new Date().toISOString(),
  }).select("id").single();
  if (convError) throw convError;

  const { error } = await db.from("commitment").insert({
    org_id: orgId, conversation_id: conversation.id, client_id: pattern.clientId,
    text: pattern.representativeText, owner: null,
    deadline: pattern.nextExpectedIso, type: "other",
    // Never 'high': nobody actually promised this yet.
    confidence: pattern.confidence === "high" ? "medium" : "low",
    source_span: "", status: "proposed", source_flagged: false,
  });
  if (error) throw error;

  // A human clicked the button — the comment above says the click is the approval — so the
  // row says human. payloadHash is dropped: the column holds a hash, not a raw user id.
  await logAudit({
    orgId, actor: "human", action: "create",
    target: `commitment:recurring:${pattern.key}`,
  });

  revalidatePath("/queue");
  revalidatePath("/tasks");
}
