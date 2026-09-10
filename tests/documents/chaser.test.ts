import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/agent/blueprint-store", () => ({ contractFor: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));

import { addRequirementForAllClients, sweepMissingDocuments } from "@/lib/documents/chaser";
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { contractFor } from "@/lib/agent/blueprint-store";

const ORG = "00000000-0000-0000-0000-00000000000a";
const CLIENT_A = "00000000-0000-0000-0000-0000000000c1";
const CLIENT_B = "00000000-0000-0000-0000-0000000000c2";
const REQUIREMENT = "00000000-0000-0000-0000-0000000000d1";

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const rows = () => tables[table] ?? (tables[table] = []);
      function chain(matchers: Array<(r: Row) => boolean> = []) {
        return {
          eq(column: string, value: unknown) {
            return chain([...matchers, (r: Row) => r[column] === value]);
          },
          is(column: string, value: unknown) {
            return chain([...matchers, (r: Row) => (r[column] ?? null) === value]);
          },
          lt(column: string, value: unknown) {
            return chain([...matchers, (r: Row) => {
              const v = r[column];
              return typeof v === "string" && v < (value as string);
            }]);
          },
          order() { return chain(matchers); },
          range(start: number, end: number) {
            const matched = rows().filter((r) => matchers.every((m) => m(r)));
            return Promise.resolve({ data: matched.slice(start, end + 1), error: null });
          },
          async maybeSingle() {
            const matched = rows().find((r) => matchers.every((m) => m(r)));
            return { data: matched ?? null, error: null };
          },
          then(resolve: (v: { data: Row[]; error: null }) => unknown) {
            const matched = rows().filter((r) => matchers.every((m) => m(r)));
            return Promise.resolve({ data: matched, error: null }).then(resolve);
          },
        };
      }
      return {
        select() { return chain(); },
        insert(row: Row | Row[]) {
          const list = Array.isArray(row) ? row : [row];
          const withIds = list.map((r, i) => ({ id: `generated-${rows().length}-${i}`, ...r }));
          rows().push(...withIds);
          return {
            then(resolve: (v: { error: null }) => unknown) {
              return Promise.resolve({ error: null }).then(resolve);
            },
            select() {
              return { async single() { return { data: withIds[0], error: null }; } };
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

beforeEach(() => {
  vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
});

describe("addRequirementForAllClients", () => {
  it("creates a missing client_document row for every existing client", async () => {
    const tables = {
      client_contact: [
        { id: CLIENT_A, org_id: ORG, name: "A" },
        { id: CLIENT_B, org_id: ORG, name: "B" },
      ],
      document_requirement: [] as Row[],
      client_document: [] as Row[],
    };
    const result = await addRequirementForAllClients(fakeDb(tables), {
      orgId: ORG, name: "Signed contract",
    });
    expect(result.clientsAffected).toBe(2);
    expect(tables.client_document).toHaveLength(2);
    expect(tables.client_document.every((d) => d.status === "missing")).toBe(true);
  });
});

describe("sweepMissingDocuments", () => {
  function seed() {
    return {
      client_contact: [{ id: CLIENT_A, org_id: ORG, name: "Jordan" }],
      document_requirement: [{ id: REQUIREMENT, org_id: ORG, name: "W-9" }],
      client_document: [{
        id: "doc-1", org_id: ORG, client_id: CLIENT_A, requirement_id: REQUIREMENT,
        status: "missing", last_reminded_at: null as string | null,
      }],
      client_message_draft: [] as Row[],
    };
  }

  it("drafts a reminder for a never-reminded missing document", async () => {
    const tables = seed();
    const result = await sweepMissingDocuments(fakeDb(tables), { orgId: ORG, now: new Date() });
    expect(result).toEqual({ drafted: 1, skipped: 0 });
    expect(tables.client_message_draft).toHaveLength(1);
    expect(tables.client_message_draft[0].kind).toBe("document_reminder");
    expect(tables.client_document[0].last_reminded_at).not.toBeNull();
  });

  it("does not re-chase within the cooloff window", async () => {
    const now = new Date("2026-01-15T00:00:00.000Z");
    const tables = seed();
    tables.client_document[0].last_reminded_at = new Date("2026-01-10T00:00:00.000Z").toISOString();
    const result = await sweepMissingDocuments(fakeDb(tables), { orgId: ORG, now });
    expect(result.drafted).toBe(0);
  });

  it("chases again once the cooloff window has passed", async () => {
    const now = new Date("2026-01-15T00:00:00.000Z");
    const tables = seed();
    tables.client_document[0].last_reminded_at = new Date("2025-12-01T00:00:00.000Z").toISOString();
    const result = await sweepMissingDocuments(fakeDb(tables), { orgId: ORG, now });
    expect(result.drafted).toBe(1);
  });

  it("skips a document already received", async () => {
    const tables = seed();
    tables.client_document[0].status = "received";
    const result = await sweepMissingDocuments(fakeDb(tables), { orgId: ORG, now: new Date() });
    expect(result).toEqual({ drafted: 0, skipped: 0 });
  });

  it("respects the blueprint denying draft_document_reminder", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: DEFAULT_BLUEPRINT.permitted_actions
        .filter((a) => a !== "draft_document_reminder"),
    }));
    const tables = seed();
    const result = await sweepMissingDocuments(fakeDb(tables), { orgId: ORG, now: new Date() });
    expect(result).toEqual({ drafted: 0, skipped: 1 });
    expect(tables.client_message_draft).toHaveLength(0);
  });
});
