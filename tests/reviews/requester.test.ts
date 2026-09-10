import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/agent/blueprint-store", () => ({ contractFor: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));

import { requestReviewIfDue } from "@/lib/reviews/requester";
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { contractFor } from "@/lib/agent/blueprint-store";

const ORG = "00000000-0000-0000-0000-00000000000a";
const CLIENT = "00000000-0000-0000-0000-0000000000c1";

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
          gte(column: string, value: string) {
            return chain([...matchers, (r: Row) => {
              const v = r[column];
              return typeof v === "string" && v >= value;
            }]);
          },
          limit(n: number) {
            return {
              async then(resolve: (v: { data: Row[]; error: null }) => unknown) {
                const matched = rows().filter((r) => matchers.every((m) => m(r))).slice(0, n);
                return Promise.resolve({ data: matched, error: null }).then(resolve);
              },
            };
          },
          async maybeSingle() {
            const matched = rows().find((r) => matchers.every((m) => m(r)));
            return { data: matched ?? null, error: null };
          },
        };
      }
      return {
        select() { return chain(); },
        insert(row: Row) {
          const withId = { id: `generated-${rows().length}`, ...row };
          rows().push(withId);
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
}

function seed(overrides: { reviewRequests?: Row[] } = {}) {
  return {
    client_contact: [{ id: CLIENT, org_id: ORG, name: "Jordan" }],
    review_request: overrides.reviewRequests ?? ([] as Row[]),
    client_message_draft: [] as Row[],
  };
}

beforeEach(() => {
  vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
});

describe("requestReviewIfDue", () => {
  it("drafts a review request for a client never asked before", async () => {
    const tables = seed();
    const result = await requestReviewIfDue(fakeDb(tables), {
      orgId: ORG, clientId: CLIENT, trigger: "task_delivered", context: "the redesign",
    });
    expect(result).toEqual({ requested: true, reason: "requested" });
    expect(tables.review_request).toHaveLength(1);
    expect(tables.client_message_draft).toHaveLength(1);
    expect(tables.client_message_draft[0].kind).toBe("review_request");
    expect(tables.client_message_draft[0].body).toContain("the redesign");
  });

  it("does not ask again within the suppression window", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const recentlyAsked = new Date("2026-05-01T00:00:00.000Z").toISOString();
    const tables = seed({ reviewRequests: [
      { id: "r1", org_id: ORG, client_id: CLIENT, trigger: "invoice_paid", requested_at: recentlyAsked },
    ] });
    const result = await requestReviewIfDue(fakeDb(tables), {
      orgId: ORG, clientId: CLIENT, trigger: "task_delivered", now,
    });
    expect(result).toEqual({ requested: false, reason: "recently_asked" });
    expect(tables.client_message_draft).toHaveLength(0);
  });

  it("asks again once the suppression window has passed", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const longAgo = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const tables = seed({ reviewRequests: [
      { id: "r1", org_id: ORG, client_id: CLIENT, trigger: "invoice_paid", requested_at: longAgo },
    ] });
    const result = await requestReviewIfDue(fakeDb(tables), {
      orgId: ORG, clientId: CLIENT, trigger: "task_delivered", now,
    });
    expect(result.requested).toBe(true);
  });

  it("respects the blueprint denying draft_review_request", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: DEFAULT_BLUEPRINT.permitted_actions
        .filter((a) => a !== "draft_review_request"),
    }));
    const tables = seed();
    const result = await requestReviewIfDue(fakeDb(tables), {
      orgId: ORG, clientId: CLIENT, trigger: "invoice_paid",
    });
    expect(result).toEqual({ requested: false, reason: "denied" });
    expect(tables.client_message_draft).toHaveLength(0);
  });

  it("works without a context string", async () => {
    const tables = seed();
    const result = await requestReviewIfDue(fakeDb(tables), {
      orgId: ORG, clientId: CLIENT, trigger: "invoice_paid",
    });
    expect(result.requested).toBe(true);
    expect(tables.client_message_draft[0].body).not.toContain("undefined");
  });
});
