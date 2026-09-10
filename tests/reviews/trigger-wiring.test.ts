import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/reviews/requester", () => ({ requestReviewIfDue: vi.fn().mockResolvedValue({ requested: true, reason: "requested" }) }));
vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));

import { setTaskStatusFor } from "@/lib/tasks/update";
import { setInvoiceStatusFor } from "@/lib/billing/transitions";
import { requestReviewIfDue } from "@/lib/reviews/requester";

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const rows = () => tables[table] ?? (tables[table] = []);
      function chain(matchers: Array<(r: Row) => boolean> = [], patch?: Row) {
        return {
          eq(column: string, value: unknown) {
            return chain([...matchers, (r: Row) => r[column] === value], patch);
          },
          select() { return chain(matchers, patch); },
          async maybeSingle() {
            const matched = rows().find((r) => matchers.every((m) => m(r)));
            return { data: matched ?? null, error: null };
          },
          then(resolve: (v: { data: Row[]; error: null }) => unknown) {
            const matched = rows().filter((r) => matchers.every((m) => m(r)));
            if (patch) matched.forEach((r) => Object.assign(r, patch));
            return Promise.resolve({ data: matched, error: null }).then(resolve);
          },
        };
      }
      return {
        select() { return chain(); },
        update(patch: Row) { return chain([], patch); },
      };
    },
  } as unknown as SupabaseClient;
}

const ORG = "org-1";
const COMMITMENT = "commitment-1";
const CLIENT = "client-1";
const TASK = "task-1";
const INVOICE = "invoice-1";

beforeEach(() => { vi.clearAllMocks(); });

describe("review-request trigger wiring", () => {
  it("requests a review when a task is marked done", async () => {
    const tables = {
      task: [{ id: TASK, org_id: ORG, commitment_id: COMMITMENT, status: "in_progress" }],
      commitment: [{ id: COMMITMENT, org_id: ORG, client_id: CLIENT, text: "Ship the redesign" }],
      reminder: [] as Row[],
    };
    await setTaskStatusFor(fakeDb(tables), { taskId: TASK, next: "done", userId: "u1" });
    expect(requestReviewIfDue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orgId: ORG, clientId: CLIENT, trigger: "task_delivered", context: "Ship the redesign",
    }));
  });

  it("does not request a review for a non-done transition", async () => {
    const tables = {
      task: [{ id: TASK, org_id: ORG, commitment_id: COMMITMENT, status: "open" }],
      commitment: [{ id: COMMITMENT, org_id: ORG, client_id: CLIENT, text: "Ship the redesign" }],
      reminder: [] as Row[],
    };
    await setTaskStatusFor(fakeDb(tables), { taskId: TASK, next: "in_progress", userId: "u1" });
    expect(requestReviewIfDue).not.toHaveBeenCalled();
  });

  it("requests a review when an invoice is marked paid", async () => {
    const tables = {
      invoice: [{ id: INVOICE, org_id: ORG, client_id: CLIENT, status: "sent" }],
    };
    await setInvoiceStatusFor(fakeDb(tables), { invoiceId: INVOICE, next: "paid", userId: "u1" });
    expect(requestReviewIfDue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orgId: ORG, clientId: CLIENT, trigger: "invoice_paid",
    }));
  });

  it("does not request a review when an invoice is only marked sent", async () => {
    const tables = {
      invoice: [{ id: INVOICE, org_id: ORG, client_id: CLIENT, status: "draft" }],
    };
    await setInvoiceStatusFor(fakeDb(tables), { invoiceId: INVOICE, next: "sent", userId: "u1" });
    expect(requestReviewIfDue).not.toHaveBeenCalled();
  });
});
