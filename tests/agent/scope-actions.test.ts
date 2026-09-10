import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ getServerClient: vi.fn() }));
vi.mock("@/lib/db/queries", () => ({ getCurrentOrgId: vi.fn() }));
vi.mock("@/lib/agent/scope-check", () => ({ gateCommitmentScope: vi.fn() }));

import { setScopeOfWork, runScopeCheck } from "@/app/actions/scope";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { gateCommitmentScope } from "@/lib/agent/scope-check";
import { MAX_SCOPE_SUMMARY_CHARS } from "@/lib/agent/schema";

const commitment = { id: "commitment-1", org_id: "org-1", client_id: "client-1", text: "Send a worksheet" };

function database(options: { role?: string; signedOut?: boolean; missingClient?: boolean; missingCommitment?: boolean } = {}) {
  const rows: Record<string, unknown> = {
    membership: { role: options.role ?? "owner" },
    client_contact: options.missingClient ? null : { id: "client-1" },
    commitment: options.missingCommitment ? null : commitment,
  };
  const queries = new Map<string, ReturnType<typeof query>>();
  function query(table: string) {
    return {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      upsert: vi.fn(async () => ({ error: null })),
      maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })),
    };
  }
  const from = vi.fn((table: string) => {
    if (!queries.has(table)) queries.set(table, query(table));
    return queries.get(table)!;
  });
  const db = { from, auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: "user-1" } } }) } };
  vi.mocked(getServerClient).mockResolvedValue(db as unknown as SupabaseClient);
  return { db, from, queries };
}

function form(summary = "  Weekly algebra tutoring.  ") {
  const data = new FormData();
  data.set("clientId", "client-1");
  data.set("summary", summary);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentOrgId).mockResolvedValue("org-1");
  vi.mocked(gateCommitmentScope).mockResolvedValue({ outcome: "skipped", reason: "no_scope_of_work" });
});

describe("scope server actions", () => {
  it("upserts the owner's summary for a client in the current org", async () => {
    const { queries } = database();
    await setScopeOfWork(form());
    expect(queries.get("membership")!.eq.mock.calls).toEqual([["org_id", "org-1"], ["user_id", "user-1"]]);
    expect(queries.get("client_contact")!.eq.mock.calls).toEqual([["id", "client-1"], ["org_id", "org-1"]]);
    expect(queries.get("scope_of_work")!.upsert).toHaveBeenCalledExactlyOnceWith({
      org_id: "org-1", client_id: "client-1", summary: "Weekly algebra tutoring.",
    }, { onConflict: "org_id,client_id" });
  });

  it.each(["", " \n\t", "x".repeat(MAX_SCOPE_SUMMARY_CHARS + 1)])("rejects an invalid summary (%#)", async (summary) => {
    const { from } = database();
    await expect(setScopeOfWork(form(summary))).rejects.toThrow();
    expect(from).not.toHaveBeenCalledWith("scope_of_work");
  });

  it("rejects a client outside the current org", async () => {
    const { from } = database({ missingClient: true });
    await expect(setScopeOfWork(form())).rejects.toThrow("Client not found");
    expect(from).not.toHaveBeenCalledWith("scope_of_work");
  });

  it.each(["set", "check"])("requires an owner to %s scope", async (action) => {
    const { from } = database({ role: "member" });
    await expect(action === "set" ? setScopeOfWork(form()) : runScopeCheck("commitment-1"))
      .rejects.toThrow("Only an owner");
    expect(from.mock.calls).toEqual([["membership"]]);
    expect(gateCommitmentScope).not.toHaveBeenCalled();
  });

  it("requires authentication before reading scope data", async () => {
    const { from } = database({ signedOut: true });
    await expect(setScopeOfWork(form())).rejects.toThrow("Sign in");
    expect(from).not.toHaveBeenCalled();
  });

  it("fetches the commitment in the current org and gives explicit approval to the gate", async () => {
    const { db, queries } = database();
    expect(await runScopeCheck("commitment-1"))
      .toEqual({ outcome: "skipped", reason: "no_scope_of_work" });
    expect(queries.get("commitment")!.eq.mock.calls).toEqual([["id", "commitment-1"], ["org_id", "org-1"]]);
    expect(gateCommitmentScope).toHaveBeenCalledExactlyOnceWith(db, commitment, { approved: true });
  });

  it("never calls the gate for a missing or other-org commitment", async () => {
    database({ missingCommitment: true });
    await expect(runScopeCheck("other-org-commitment")).rejects.toThrow("Commitment not found");
    expect(gateCommitmentScope).not.toHaveBeenCalled();
  });

  it("preserves blueprint denial returned by the gate", async () => {
    database();
    vi.mocked(gateCommitmentScope).mockResolvedValue({ outcome: "denied", reason: "turned_off" });
    expect(await runScopeCheck("commitment-1")).toEqual({ outcome: "denied", reason: "turned_off" });
  });
});
