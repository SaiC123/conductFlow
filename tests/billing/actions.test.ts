import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ getServerClient: vi.fn() }));
vi.mock("@/lib/db/service", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/db/queries", () => ({ getCurrentOrgId: vi.fn() }));
vi.mock("@/lib/billing/time", () => ({ logTimeEntry: vi.fn() }));
vi.mock("@/lib/billing/invoicing", () => ({ draftInvoiceFromTimeEntries: vi.fn(), sweepOverdueInvoices: vi.fn() }));
vi.mock("@/lib/billing/transitions", () => ({ setInvoiceStatusFor: vi.fn() }));
vi.mock("@/lib/gmail/push-client-message", () => ({ pushClientMessageToGmail: vi.fn() }));
vi.mock("@/lib/google/tokens", () => ({
  getAccessToken: vi.fn(), invalidateCachedToken: vi.fn(),
  DataSourceUnavailable: class extends Error { constructor(message: string, public reason: string) { super(message); } },
}));

import { logTime, draftInvoice, markInvoiceSent, markInvoicePaid, runCollectionsSweep, pushInvoiceDraft } from "@/app/actions/billing";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { logTimeEntry } from "@/lib/billing/time";
import { draftInvoiceFromTimeEntries, sweepOverdueInvoices } from "@/lib/billing/invoicing";
import { setInvoiceStatusFor } from "@/lib/billing/transitions";
import { pushClientMessageToGmail } from "@/lib/gmail/push-client-message";
import { GmailInvalidGrantError, GmailUnauthorizedError } from "@/lib/gmail/client";
import { getAccessToken, invalidateCachedToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { fakeDb, type Tables } from "./fake-db";

let db: SupabaseClient, service: SupabaseClient, tables: Tables;
beforeEach(() => {
  vi.resetAllMocks();
  tables = {
    client_message_draft: [{ id: "draft-1", org_id: "draft-org", kind: "invoice" }],
    connected_data_source: [{ id: "google-1", org_id: "draft-org", provider: "google", account_email: "owner@example.com" }],
  };
  db = fakeDb(tables); service = fakeDb(tables);
  Object.assign(db, { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) } });
  vi.mocked(getServerClient).mockResolvedValue(db);
  vi.mocked(getServiceClient).mockReturnValue(service);
  vi.mocked(getCurrentOrgId).mockResolvedValue("session-org");
  vi.mocked(getAccessToken).mockResolvedValue("access-token");
  vi.mocked(pushClientMessageToGmail).mockResolvedValue({ outcome: "pushed", providerDraftId: "gmail-1", providerMessageId: "message-1" });
});

describe("billing server actions", () => {
  it("passes authenticated identity to time logging and state changes", async () => {
    await logTime("client-1", 30, "Review");
    expect(logTimeEntry).toHaveBeenCalledWith(db, { clientId: "client-1", minutes: 30, note: "Review", userId: "user-1" });
    await markInvoiceSent("invoice-1"); await markInvoicePaid("invoice-1");
    expect(setInvoiceStatusFor).toHaveBeenNthCalledWith(1, db, { invoiceId: "invoice-1", next: "sent", userId: "user-1" });
    expect(setInvoiceStatusFor).toHaveBeenNthCalledWith(2, db, { invoiceId: "invoice-1", next: "paid", userId: "user-1" });
  });
  it("uses the session org for invoice creation and manual sweeps", async () => {
    await draftInvoice("client-1"); await runCollectionsSweep();
    expect(draftInvoiceFromTimeEntries).toHaveBeenCalledWith(db, { clientId: "client-1", orgId: "session-org" });
    expect(sweepOverdueInvoices).toHaveBeenCalledWith(db, { orgId: "session-org" });
  });
  it("never widens a manual sweep when the session has no org", async () => {
    vi.mocked(getCurrentOrgId).mockResolvedValue(null);
    await expect(runCollectionsSweep()).rejects.toThrow("Sign in");
    expect(sweepOverdueInvoices).not.toHaveBeenCalled();
  });
  it("rejects all actions when signed out", async () => {
    Object.assign(db.auth, { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) });
    for (const action of [() => logTime("c", 1), () => draftInvoice("c"),
      () => markInvoiceSent("i"), () => markInvoicePaid("i"), runCollectionsSweep, () => pushInvoiceDraft("d")]) {
      await expect(action()).rejects.toThrow("Sign in");
    }
    expect(getServiceClient).not.toHaveBeenCalled();
  });
});

describe("pushInvoiceDraft", () => {
  it("uses the draft org established through the authenticated client", async () => {
    expect(await pushInvoiceDraft("draft-1")).toEqual({ pushed: true, reason: "pushed" });
    expect(getAccessToken).toHaveBeenCalledWith(service, "draft-org", expect.any(String));
    expect(pushClientMessageToGmail).toHaveBeenCalledWith(service, {
      draftId: "draft-1", orgId: "draft-org", userId: "user-1", from: "owner@example.com", accessToken: "access-token",
    });
  });
  it("accepts collections drafts too", async () => {
    tables.client_message_draft[0].kind = "collections_reminder";
    expect((await pushInvoiceDraft("draft-1")).pushed).toBe(true);
  });
  it.each(["missing", "retainer_renewal"])("does not use service access for an inaccessible or wrong-kind draft: %s", async (kind) => {
    tables.client_message_draft[0].kind = kind;
    expect(await pushInvoiceDraft("draft-1")).toEqual({ pushed: false, reason: "draft not found" });
    expect(getServiceClient).not.toHaveBeenCalled();
  });
  it("flags invalid grants for reconnect and clears the cached token", async () => {
    vi.mocked(pushClientMessageToGmail).mockRejectedValue(new GmailInvalidGrantError("revoked", 401));
    expect(await pushInvoiceDraft("draft-1")).toEqual({ pushed: false, reason: "google_reconnect_required" });
    expect(tables.connected_data_source[0]).toMatchObject({ state: "error", last_error: "revoked" });
    expect(invalidateCachedToken).toHaveBeenCalledWith("google-1");
  });
  it("clears rejected access tokens for retry without flagging a reconnect", async () => {
    vi.mocked(pushClientMessageToGmail).mockRejectedValue(new GmailUnauthorizedError("rejected", 401));
    expect(await pushInvoiceDraft("draft-1")).toEqual({ pushed: false, reason: "gmail_auth_rejected_retry" });
    expect(invalidateCachedToken).toHaveBeenCalledWith("google-1");
    expect(tables.connected_data_source[0].state).toBeUndefined();
  });
  it("returns source-unavailable and other push failures", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new DataSourceUnavailable("not connected", "missing"));
    expect(await pushInvoiceDraft("draft-1")).toEqual({ pushed: false, reason: "missing" });
    vi.mocked(getAccessToken).mockResolvedValue("access-token");
    vi.mocked(pushClientMessageToGmail).mockRejectedValue(new Error("network error"));
    expect(await pushInvoiceDraft("draft-1")).toEqual({ pushed: false, reason: "network error" });
  });
});
