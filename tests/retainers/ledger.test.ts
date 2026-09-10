import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/agent/blueprint-store", () => ({ contractFor: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));

import { logRetainerUsage } from "@/lib/retainers/ledger";
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { contractFor } from "@/lib/agent/blueprint-store";

const ORG = "00000000-0000-0000-0000-00000000000a";
const CLIENT = "00000000-0000-0000-0000-0000000000c1";
const RETAINER = "00000000-0000-0000-0000-0000000000r1";

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const rows = () => tables[table] ?? (tables[table] = []);
      return {
        select() {
          return {
            eq(column: string, value: unknown) {
              return {
                async maybeSingle() {
                  return { data: rows().find((r) => r[column] === value) ?? null, error: null };
                },
              };
            },
          };
        },
        insert(row: Row) {
          const withId = { id: `generated-${rows().length}`, ...row };
          rows().push(withId);
          return {
            async then(resolve: (v: { error: null }) => unknown) {
              return Promise.resolve({ error: null }).then(resolve);
            },
            select() {
              return { async single() { return { data: withId, error: null }; } };
            },
          };
        },
        update(patch: Row) {
          return {
            eq(column: string, value: unknown) {
              const row = rows().find((r) => r[column] === value);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function seed(overrides: Partial<Row> = {}) {
  return {
    retainer: [{
      id: RETAINER, org_id: ORG, client_id: CLIENT, label: "10-hour tutoring package",
      unit: "hours", total_units: 10, used_units: 0, low_balance_threshold: 2,
      status: "active", renewal_offered_at: null,
      ...overrides,
    }],
    client_contact: [{ id: CLIENT, org_id: ORG, name: "Jordan", email: "jordan@example.com" }],
    retainer_usage: [] as Row[],
    client_message_draft: [] as Row[],
  };
}

beforeEach(() => {
  vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
});

describe("logRetainerUsage", () => {
  it("decrements the balance and stays active above threshold", async () => {
    const tables = seed();
    const result = await logRetainerUsage(fakeDb(tables), {
      retainerId: RETAINER, units: 3, userId: null,
    });
    expect(result).toEqual({ remaining: 7, status: "active", renewalDrafted: false });
    expect(tables.retainer[0].used_units).toBe(3);
    expect(tables.client_message_draft).toHaveLength(0);
  });

  it("drafts a renewal offer exactly once when balance crosses the threshold", async () => {
    const tables = seed();
    const first = await logRetainerUsage(fakeDb(tables), {
      retainerId: RETAINER, units: 8, userId: null,
    });
    expect(first.remaining).toBe(2);
    expect(first.renewalDrafted).toBe(true);
    expect(tables.client_message_draft).toHaveLength(1);
    expect(tables.client_message_draft[0].kind).toBe("retainer_renewal");
    expect(tables.retainer[0].renewal_offered_at).not.toBeNull();

    // Logging again while still below threshold must not draft a second offer.
    const db2 = fakeDb(tables);
    const second = await logRetainerUsage(db2, { retainerId: RETAINER, units: 1, userId: null });
    expect(second.renewalDrafted).toBe(false);
    expect(tables.client_message_draft).toHaveLength(1);
  });

  it("marks the retainer exhausted at zero remaining", async () => {
    const tables = seed();
    const result = await logRetainerUsage(fakeDb(tables), {
      retainerId: RETAINER, units: 10, userId: null,
    });
    expect(result.status).toBe("exhausted");
    expect(tables.retainer[0].status).toBe("exhausted");
  });

  it("does not draft a renewal when the blueprint denies it", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: DEFAULT_BLUEPRINT.permitted_actions
        .filter((a) => a !== "draft_retainer_renewal"),
    }));
    const tables = seed();
    const result = await logRetainerUsage(fakeDb(tables), {
      retainerId: RETAINER, units: 9, userId: null,
    });
    expect(result.renewalDrafted).toBe(false);
    expect(tables.client_message_draft).toHaveLength(0);
  });

  it("rejects non-positive usage", async () => {
    await expect(logRetainerUsage(fakeDb(seed()), {
      retainerId: RETAINER, units: 0, userId: null,
    })).rejects.toThrow(/positive/);
  });

  it("refuses to log usage against a non-active retainer", async () => {
    const tables = seed({ status: "exhausted" });
    await expect(logRetainerUsage(fakeDb(tables), {
      retainerId: RETAINER, units: 1, userId: null,
    })).rejects.toThrow(/exhausted/);
  });

  it("throws when the retainer does not exist", async () => {
    await expect(logRetainerUsage(fakeDb(seed()), {
      retainerId: "missing", units: 1, userId: null,
    })).rejects.toThrow(/not found/i);
  });
});
