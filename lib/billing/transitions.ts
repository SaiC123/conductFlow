import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit/log";

export const INVOICE_STATES = ["draft", "sent", "paid", "overdue", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATES)[number];

const ALLOWED: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["sent", "void"],
  sent: ["paid", "overdue", "void"],
  overdue: ["paid", "void"],
  paid: [],
  void: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): { ok: boolean; reason: string } {
  if (!INVOICE_STATES.includes(from) || !INVOICE_STATES.includes(to)) {
    return { ok: false, reason: "unknown invoice state" };
  }
  if (from === to) return { ok: true, reason: "already in that state" };
  if (!ALLOWED[from].includes(to)) {
    return { ok: false, reason: `cannot transition invoice from ${from} to ${to}` };
  }
  return { ok: true, reason: "allowed" };
}

export async function setInvoiceStatusFor(
  db: SupabaseClient,
  args: { invoiceId: string; next: "sent" | "paid"; userId: string | null; now?: Date },
): Promise<{ status: InvoiceStatus }> {
  const { data: invoice, error } = await db.from("invoice")
    .select("id,org_id,status").eq("id", args.invoiceId).maybeSingle();
  if (error) throw error;
  if (!invoice) throw new Error("invoice not found");
  const decision = canTransition(invoice.status as InvoiceStatus, args.next);
  if (!decision.ok) throw new Error(decision.reason);
  if (invoice.status === args.next) return { status: args.next };

  const { data: updated, error: updateError } = await db.from("invoice").update({
    status: args.next,
    [args.next === "sent" ? "sent_at" : "paid_at"]: (args.now ?? new Date()).toISOString(),
  }).eq("id", invoice.id).eq("org_id", invoice.org_id).eq("status", invoice.status).select("id");
  if (updateError) throw updateError;
  if (!updated?.length) throw new Error("invoice changed; reload before trying again");

  await logAudit({
    orgId: invoice.org_id as string, actor: args.userId ? "human" : "agent", action: "update",
    target: `invoice:${invoice.id}:${args.next}`,
  });
  return { status: args.next };
}
