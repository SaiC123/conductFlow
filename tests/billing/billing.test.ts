import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/blueprint-store", () => ({ contractFor: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));

import { logTimeEntry } from "@/lib/billing/time";
import { draftInvoiceFromTimeEntries, sweepOverdueInvoices } from "@/lib/billing/invoicing";
import { canTransition, INVOICE_STATES, setInvoiceStatusFor } from "@/lib/billing/transitions";
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";
import { fakeDb, type Tables } from "./fake-db";

const ORG = "org-a", CLIENT = "client-a";
const now = new Date("2026-09-09T12:00:00.000Z");
const invoiceArgs = { orgId: ORG, clientId: CLIENT, now };
function seed(): Tables {
  return {
    client_contact: [{ id: CLIENT, org_id: ORG, name: "Jordan" }],
    billing_rate: [{ id: "rate-1", org_id: ORG, client_id: null, unit: "hourly", amount_cents: 10000 }],
    time_entry: [
      { id: "time-1", org_id: ORG, client_id: CLIENT, minutes: 45, invoiced: false },
      { id: "time-2", org_id: ORG, client_id: CLIENT, minutes: 30, invoiced: false },
      { id: "time-3", org_id: ORG, client_id: CLIENT, minutes: 60, invoiced: true, invoice_id: "old" },
      { id: "time-4", org_id: ORG, client_id: "other-client", minutes: 60, invoiced: false },
      { id: "time-5", org_id: "other-org", client_id: CLIENT, minutes: 60, invoiced: false },
    ],
    invoice: [], client_message_draft: [],
  };
}
function collectionsSeed(): Tables {
  const tables = seed();
  tables.invoice.push({ id: "invoice-1", org_id: ORG, client_id: CLIENT,
    status: "sent", total_cents: 12500, due_date: "2026-09-08", last_reminded_at: null });
  return tables;
}
function deny(action: string) {
  vi.mocked(contractFor).mockResolvedValue(blueprintToContract({ ...DEFAULT_BLUEPRINT,
    permitted_actions: DEFAULT_BLUEPRINT.permitted_actions.filter((a) => a !== action) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
});

describe("logTimeEntry", () => {
  it("derives the org from the client and records minutes, note, user and clock", async () => {
    const tables = seed();
    const result = await logTimeEntry(fakeDb(tables), { clientId: CLIENT, minutes: 25, note: "Review", userId: "user", now });
    expect(tables.time_entry.at(-1)).toMatchObject({ id: result.timeEntryId,
      org_id: ORG, client_id: CLIENT, minutes: 25, note: "Review", logged_by: "user", invoiced: false, created_at: now.toISOString() });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, actor: "human", action: "create" }));
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648])("rejects invalid minutes %s", async (minutes) => {
    const tables = seed();
    await expect(logTimeEntry(fakeDb(tables), { clientId: CLIENT, minutes, userId: null })).rejects.toThrow("positive integer");
    expect(tables.time_entry).toHaveLength(5);
  });
  it("rejects an inaccessible client", async () => {
    await expect(logTimeEntry(fakeDb(seed()), { clientId: "missing", minutes: 1, userId: null })).rejects.toThrow("client not found");
  });
  it("propagates insert failures without auditing success", async () => {
    await expect(logTimeEntry(fakeDb(seed(), { failTable: "time_entry" }),
      { clientId: CLIENT, minutes: 1, userId: null })).rejects.toThrow("write failed");
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("draftInvoiceFromTimeEntries", () => {
  it("rolls up only this org/client's un-invoiced time using the default rate", async () => {
    const tables = seed();
    const db = fakeDb(tables);
    const result = await draftInvoiceFromTimeEntries(db, invoiceArgs);
    expect(result).toMatchObject({ totalCents: 12500, entriesInvoiced: 2 });
    expect(tables.invoice).toEqual([expect.objectContaining({ id: result.invoiceId, status: "draft", total_cents: 12500, due_date: "2026-10-09" })]);
    expect(tables.time_entry.slice(0, 2).every((entry) => entry.invoiced && entry.invoice_id === result.invoiceId)).toBe(true);
    expect(tables.time_entry[2].invoice_id).toBe("old");
    expect(tables.time_entry.slice(3).every((entry) => !entry.invoiced)).toBe(true);
    expect(tables.client_message_draft[0]).toMatchObject({ id: result.draftId, kind: "invoice", source_id: result.invoiceId });
    expect(tables.client_message_draft[0].body).toContain("$125.00");
    await expect(draftInvoiceFromTimeEntries(db, invoiceArgs)).rejects.toThrow("no un-invoiced time entries");
    expect(tables.invoice).toHaveLength(1);
  });
  it("prefers a client rate over the org default", async () => {
    const tables = seed();
    tables.billing_rate.push({ id: "client-rate", org_id: ORG, client_id: CLIENT, unit: "hourly", amount_cents: 12000 });
    expect(await draftInvoiceFromTimeEntries(fakeDb(tables), invoiceArgs)).toMatchObject({ totalCents: 15000 });
  });
  it("throws clearly if neither rate exists", async () => {
    const tables = seed(); tables.billing_rate = [];
    await expect(draftInvoiceFromTimeEntries(fakeDb(tables), invoiceArgs)).rejects.toThrow("no billing rate configured");
    expect(tables.invoice).toHaveLength(0);
    expect(tables.time_entry[0].invoiced).toBe(false);
  });
  it.each(["flat", "per_session"])("rejects ambiguous %s time billing", async (unit) => {
    const tables = seed(); tables.billing_rate[0].unit = unit;
    await expect(draftInvoiceFromTimeEntries(fakeDb(tables), invoiceArgs)).rejects.toThrow("hourly");
  });
  it("rounds the combined amount half up without rounding individual entries", async () => {
    const tables = seed(); tables.billing_rate[0].amount_cents = 1;
    tables.time_entry = [1, 2].map((id) => ({ id: String(id), org_id: ORG, client_id: CLIENT, minutes: 15, invoiced: false }));
    expect(await draftInvoiceFromTimeEntries(fakeDb(tables), invoiceArgs)).toMatchObject({ totalCents: 1 });
    expect(tables.client_message_draft[0].body).toContain("$0.01");
  });
  it("rejects totals that cannot fit integer cents", async () => {
    const tables = seed(); tables.billing_rate[0].amount_cents = 2147483647;
    await expect(draftInvoiceFromTimeEntries(fakeDb(tables), invoiceArgs)).rejects.toThrow("database limit");
  });
  it("paginates more than 1,000 time entries", async () => {
    const tables = seed();
    tables.time_entry = Array.from({ length: 1001 }, (_, i) => ({ id: String(i).padStart(4, "0"), org_id: ORG, client_id: CLIENT, minutes: 60, invoiced: false }));
    expect(await draftInvoiceFromTimeEntries(fakeDb(tables), invoiceArgs)).toMatchObject({ entriesInvoiced: 1001, totalCents: 10010000 });
  });
  it("does not consume time or create an invoice when the draft write fails", async () => {
    const tables = seed();
    await expect(draftInvoiceFromTimeEntries(fakeDb(tables, { failTable: "client_message_draft" }), invoiceArgs)).rejects.toThrow("write failed");
    expect(tables.invoice).toHaveLength(0);
    expect(tables.time_entry[0].invoiced).toBe(false);
  });
  it("rejects a competing rollup that already claimed the same entries", async () => {
    const tables = seed();
    const results = await Promise.allSettled([1, 2].map(() => draftInvoiceFromTimeEntries(fakeDb(tables), invoiceArgs)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(tables.invoice).toHaveLength(1);
    expect(tables.client_message_draft).toHaveLength(1);
  });
  it("blueprint denial leaves invoice, time and message untouched", async () => {
    deny("draft_invoice"); const tables = seed();
    await expect(draftInvoiceFromTimeEntries(fakeDb(tables), invoiceArgs)).rejects.toThrow("turned_off");
    expect(tables.invoice).toHaveLength(0);
    expect(tables.client_message_draft).toHaveLength(0);
    expect(tables.time_entry[0].invoiced).toBe(false);
  });
  it("rejects a client outside the requested org", async () => {
    await expect(draftInvoiceFromTimeEntries(fakeDb(seed()), { ...invoiceArgs, orgId: "other" })).rejects.toThrow("client not found");
  });
});

describe("sweepOverdueInvoices", () => {
  it("marks overdue and drafts once per seven-day cooloff", async () => {
    const tables = collectionsSeed(); const db = fakeDb(tables);
    expect(await sweepOverdueInvoices(db, { orgId: ORG, now })).toEqual({ drafted: 1, skipped: 0 });
    expect(tables.invoice[0]).toMatchObject({ status: "overdue", last_reminded_at: now.toISOString() });
    expect(tables.client_message_draft[0]).toMatchObject({ kind: "collections_reminder", source_id: "invoice-1" });
    expect(tables.client_message_draft[0].body).toContain("$125.00");
    expect((await sweepOverdueInvoices(db, { now })).drafted).toBe(0);
    expect((await sweepOverdueInvoices(db, { now: new Date("2026-09-16T12:00:00Z") })).drafted).toBe(0);
    expect((await sweepOverdueInvoices(db, { now: new Date("2026-09-16T12:00:00.001Z") })).drafted).toBe(1);
    expect(tables.client_message_draft).toHaveLength(2);
  });
  it("blueprint denial still marks overdue without consuming the cooloff", async () => {
    deny("draft_collections_reminder"); const tables = collectionsSeed();
    expect(await sweepOverdueInvoices(fakeDb(tables), { now })).toEqual({ drafted: 0, skipped: 1 });
    expect(tables.invoice[0]).toMatchObject({ status: "overdue", last_reminded_at: null });
    expect(tables.client_message_draft).toHaveLength(0);
  });
  it.each(["draft", "paid", "void"])("ignores %s invoices", async (status) => {
    const tables = collectionsSeed(); tables.invoice[0].status = status;
    expect(await sweepOverdueInvoices(fakeDb(tables), { now })).toEqual({ drafted: 0, skipped: 0 });
  });
  it.each([null, "2026-09-09", "2026-09-10"])("ignores a not-past due date of %s", async (due_date) => {
    const tables = collectionsSeed(); tables.invoice[0].due_date = due_date;
    expect((await sweepOverdueInvoices(fakeDb(tables), { now })).drafted).toBe(0);
    expect(tables.invoice[0].status).toBe("sent");
  });
  it("scopes an org sweep and permits a global sweep", async () => {
    const tables = collectionsSeed();
    expect((await sweepOverdueInvoices(fakeDb(tables), { orgId: "other", now })).drafted).toBe(0);
    expect((await sweepOverdueInvoices(fakeDb(tables), { now })).drafted).toBe(1);
  });
  it("reads all pages before updating status", async () => {
    const tables = collectionsSeed(); const first = tables.invoice[0];
    tables.invoice = Array.from({ length: 1001 }, (_, i) => ({ ...first, id: String(i).padStart(4, "0") }));
    expect((await sweepOverdueInvoices(fakeDb(tables), { now })).drafted).toBe(1001);
    expect(tables.invoice.every((invoice) => invoice.status === "overdue")).toBe(true);
    expect(contractFor).toHaveBeenCalledTimes(1);
  });
  it("does not consume the cooloff on a failed draft", async () => {
    const tables = collectionsSeed();
    await expect(sweepOverdueInvoices(fakeDb(tables, { failTable: "client_message_draft" }), { now })).rejects.toThrow("write failed");
    expect(tables.invoice[0].last_reminded_at).toBeNull();
    expect((await sweepOverdueInvoices(fakeDb(tables), { now })).drafted).toBe(1);
  });
  it("rechecks payment before drafting", async () => {
    const tables = collectionsSeed();
    const db = fakeDb(tables, { beforeRpc: () => { tables.invoice[0].status = "paid"; } });
    expect((await sweepOverdueInvoices(db, { now })).drafted).toBe(0);
    expect(tables.client_message_draft).toHaveLength(0);
  });
  it("does not overwrite payment made before the overdue update", async () => {
    const tables = collectionsSeed();
    const db = fakeDb(tables, { beforeUpdate: () => { tables.invoice[0].status = "paid"; } });
    expect((await sweepOverdueInvoices(db, { now })).drafted).toBe(0);
    expect(tables.invoice[0].status).toBe("paid");
  });
  it("concurrent sweeps draft once", async () => {
    const tables = collectionsSeed(); tables.invoice[0].status = "overdue";
    await Promise.all([1, 2].map(() => sweepOverdueInvoices(fakeDb(tables), { now })));
    expect(tables.client_message_draft).toHaveLength(1);
  });
});

describe("invoice transitions", () => {
  it("permits only the defined transitions, including idempotent repeats", () => {
    const allowed = new Set(["draft:sent", "draft:void", "sent:paid", "sent:overdue", "sent:void", "overdue:paid", "overdue:void"]);
    for (const from of INVOICE_STATES) for (const to of INVOICE_STATES) {
      expect(canTransition(from, to).ok).toBe(from === to || allowed.has(`${from}:${to}`));
    }
  });
  it.each([["draft", "paid"], ["paid", "sent"], ["void", "paid"], ["overdue", "sent"]] as const)("rejects %s to %s", async (status, next) => {
    const tables = collectionsSeed(); tables.invoice[0].status = status;
    await expect(setInvoiceStatusFor(fakeDb(tables), { invoiceId: "invoice-1", next, userId: "user", now })).rejects.toThrow("cannot transition");
    expect(tables.invoice[0].status).toBe(status);
    expect(logAudit).not.toHaveBeenCalled();
  });
  it("sent and paid repeats preserve the first timestamps and audit only changes", async () => {
    const tables = collectionsSeed(); tables.invoice[0].status = "draft";
    const db = fakeDb(tables);
    for (const next of ["sent", "paid"] as const) {
      await setInvoiceStatusFor(db, { invoiceId: "invoice-1", next, userId: "user", now });
      await setInvoiceStatusFor(db, { invoiceId: "invoice-1", next, userId: "user", now: new Date("2026-09-10") });
    }
    expect(tables.invoice[0]).toMatchObject({ status: "paid", sent_at: now.toISOString(), paid_at: now.toISOString() });
    expect(logAudit).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite a concurrent state transition", async () => {
    const tables = collectionsSeed(); tables.invoice[0].status = "draft";
    const db = fakeDb(tables, { beforeUpdate: () => { tables.invoice[0].status = "void"; } });
    await expect(setInvoiceStatusFor(db, { invoiceId: "invoice-1", next: "sent", userId: "user" })).rejects.toThrow("invoice changed");
    expect(tables.invoice[0].status).toBe("void");
  });
});

describe("billing source gating", () => {
  it.each(["client_contact", "template"])("requires the %s source for both drafting actions", async (source) => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({ ...DEFAULT_BLUEPRINT,
      allowed_sources: DEFAULT_BLUEPRINT.allowed_sources.filter((s) => s !== source) }));
    await expect(draftInvoiceFromTimeEntries(fakeDb(seed()), invoiceArgs)).rejects.toThrow("source_not_allowed");
    const tables = collectionsSeed();
    expect(await sweepOverdueInvoices(fakeDb(tables), { now })).toEqual({ drafted: 0, skipped: 1 });
    expect(tables.client_message_draft).toHaveLength(0);
  });
});
