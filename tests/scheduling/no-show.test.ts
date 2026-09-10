import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/agent/blueprint-store", () => ({ contractFor: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));

import { markSession, sweepNoShows, type SessionOutcome } from "@/lib/scheduling/no-show";
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

const ORG = "00000000-0000-0000-0000-00000000000a";
const CLIENT = "00000000-0000-0000-0000-0000000000c1";
const NOW = new Date("2026-09-09T16:00:00.000Z");

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
  vi.clearAllMocks();
  vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
});

function seed() {
  return {
    client_contact: [{ id: CLIENT, org_id: ORG, name: "Jordan" }],
    no_show_policy: [{ org_id: ORG, policy_text: "One free reschedule with notice." }],
    scheduled_session: [{
      id: "session-1", org_id: ORG, client_id: CLIENT,
      starts_at: "2026-09-09T15:00:00.000Z", status: "scheduled",
      reschedule_offered_at: null as string | null,
      slot_reopening_proposed_at: null as string | null,
      policy_applied: null, updated_at: null as string | null,
    }],
    client_message_draft: [] as Row[],
  };
}

function denyDrafting() {
  vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
    ...DEFAULT_BLUEPRINT,
    permitted_actions: DEFAULT_BLUEPRINT.permitted_actions
      .filter((a) => a !== "draft_reschedule_offer"),
  }));
}

describe("sweepNoShows", () => {
  it("drafts for a past scheduled session without inferring attendance or applying a fee", async () => {
    const tables = seed();
    expect(await sweepNoShows(fakeDb(tables), { orgId: ORG, now: NOW }))
      .toEqual({ drafted: 1, skipped: 0 });
    expect(tables.client_message_draft).toHaveLength(1);
    expect(tables.client_message_draft[0]).toMatchObject({
      org_id: ORG, client_id: CLIENT, kind: "reschedule_offer", source_id: "session-1",
    });
    expect(tables.client_message_draft[0].body).toContain("Hi Jordan");
    expect(tables.client_message_draft[0].body).toContain("If we missed each other");
    expect(tables.client_message_draft[0].body).toContain(tables.no_show_policy[0].policy_text);
    expect(tables.scheduled_session[0]).toMatchObject({
      status: "scheduled", policy_applied: null,
      reschedule_offered_at: NOW.toISOString(), slot_reopening_proposed_at: NOW.toISOString(),
    });
    expect(logAudit).toHaveBeenCalledWith({
      orgId: ORG, actor: "agent", action: "draft",
      target: "scheduled_session:session-1:reschedule_offer",
    });
  });

  it("does not draft a second offer on a repeat sweep", async () => {
    const tables = seed();
    const db = fakeDb(tables);
    await sweepNoShows(db, { now: NOW });
    expect(await sweepNoShows(db, { now: NOW })).toEqual({ drafted: 0, skipped: 0 });
    expect(tables.client_message_draft).toHaveLength(1);
  });

  it("recovers an existing draft whose session timestamp was not saved", async () => {
    const tables = seed();
    tables.client_message_draft.push({
      id: "existing", org_id: ORG, source_id: "session-1", kind: "reschedule_offer",
    });
    expect(await sweepNoShows(fakeDb(tables), { now: NOW })).toEqual({ drafted: 0, skipped: 1 });
    expect(tables.client_message_draft).toHaveLength(1);
    expect(tables.scheduled_session[0].reschedule_offered_at).toBe(NOW.toISOString());
  });

  it.each(["completed", "cancelled", "rescheduled"])("does not touch a %s session", async (status) => {
    const tables = seed();
    tables.scheduled_session[0].status = status;
    const original = { ...tables.scheduled_session[0] };
    expect(await sweepNoShows(fakeDb(tables), { now: NOW })).toEqual({ drafted: 0, skipped: 0 });
    expect(tables.scheduled_session[0]).toEqual(original);
    expect(tables.client_message_draft).toHaveLength(0);
  });

  it.each([NOW.toISOString(), "2026-09-10T16:00:00.000Z"])("ignores a session starting at %s", async (startsAt) => {
    const tables = seed();
    tables.scheduled_session[0].starts_at = startsAt;
    expect(await sweepNoShows(fakeDb(tables), { now: NOW })).toEqual({ drafted: 0, skipped: 0 });
  });

  it("respects the blueprint denying draft_reschedule_offer", async () => {
    denyDrafting();
    const tables = seed();
    expect(await sweepNoShows(fakeDb(tables), { now: NOW })).toEqual({ drafted: 0, skipped: 1 });
    expect(tables.client_message_draft).toHaveLength(0);
    expect(tables.scheduled_session[0].reschedule_offered_at).toBeNull();
    expect(tables.scheduled_session[0].slot_reopening_proposed_at).toBeNull();
  });

  it.each(["client_contact", "template"])("requires the %s source", async (source) => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT, allowed_sources: DEFAULT_BLUEPRINT.allowed_sources.filter((s) => s !== source),
    }));
    const tables = seed();
    expect(await sweepNoShows(fakeDb(tables), { now: NOW })).toEqual({ drafted: 0, skipped: 1 });
    expect(tables.client_message_draft).toHaveLength(0);
  });

  it("uses the injected clock for blueprint expiry", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT, created_at: "2026-09-09T14:00:00.000Z",
    }));
    expect(await sweepNoShows(fakeDb(seed()), { now: NOW })).toEqual({ drafted: 0, skipped: 1 });
  });

  it("uses a neutral offer when the org has no policy", async () => {
    const tables = seed();
    tables.no_show_policy = [];
    await sweepNoShows(fakeDb(tables), { now: NOW });
    expect(tables.client_message_draft[0].body).not.toContain("Our no-show policy");
    expect(tables.client_message_draft[0].body).not.toContain("fee");
  });

  it("scopes sessions and policy text to the requested org", async () => {
    const tables = seed();
    tables.scheduled_session.push({ ...tables.scheduled_session[0], id: "other", org_id: "other-org" });
    tables.no_show_policy = [{ org_id: "other-org", policy_text: "Other org secret" }];
    expect(await sweepNoShows(fakeDb(tables), { orgId: ORG, now: NOW })).toEqual({ drafted: 1, skipped: 0 });
    expect(tables.client_message_draft[0].body).not.toContain("Other org secret");
    expect(tables.scheduled_session[1].reschedule_offered_at).toBeNull();
  });

  it("reads past the first 1,000 rows before updating the due set", async () => {
    const tables = seed();
    tables.scheduled_session = Array.from({ length: 1001 }, (_, i) => ({
      ...tables.scheduled_session[0], id: `session-${String(i).padStart(4, "0")}`,
    }));
    expect(await sweepNoShows(fakeDb(tables), { now: NOW })).toEqual({ drafted: 1001, skipped: 0 });
    expect(tables.client_message_draft).toHaveLength(1001);
    expect(contractFor).toHaveBeenCalledTimes(1);
  });
});

describe("markSession", () => {
  it.each(["no_show", "completed", "cancelled"] as const)("marks a scheduled session as %s", async (status) => {
    const tables = seed();
    const result = await markSession(fakeDb(tables), {
      sessionId: "session-1", status, userId: "owner", now: NOW,
    });
    expect(result).toEqual({ status, rescheduleDrafted: status === "no_show" });
    expect(tables.scheduled_session[0].status).toBe(status);
    expect(tables.scheduled_session[0].updated_at).toBe(NOW.toISOString());
    expect(tables.client_message_draft).toHaveLength(status === "no_show" ? 1 : 0);
    expect(logAudit).toHaveBeenCalledWith({
      orgId: ORG, actor: "human", action: "update", target: `scheduled_session:session-1:${status}`,
    });
  });

  it.each(["completed", "cancelled", "no_show", "rescheduled"])("rejects a transition from %s", async (status) => {
    const tables = seed();
    tables.scheduled_session[0].status = status;
    await expect(markSession(fakeDb(tables), {
      sessionId: "session-1", status: "completed", userId: "owner", now: NOW,
    })).rejects.toThrow(`cannot mark a ${status} session`);
    expect(tables.scheduled_session[0].status).toBe(status);
    expect(tables.client_message_draft).toHaveLength(0);
  });

  it("rejects a forged status and an unknown session", async () => {
    const db = fakeDb(seed());
    await expect(markSession(db, {
      sessionId: "session-1", status: "invalid" as SessionOutcome, userId: "owner", now: NOW,
    })).rejects.toThrow("invalid session status");
    await expect(markSession(db, {
      sessionId: "missing", status: "completed", userId: "owner", now: NOW,
    })).rejects.toThrow("session not found");
  });

  it.each(["completed", "no_show"] as const)("rejects marking a future session %s", async (status) => {
    const tables = seed();
    tables.scheduled_session[0].starts_at = "2026-09-10T16:00:00.000Z";
    await expect(markSession(fakeDb(tables), {
      sessionId: "session-1", status, userId: "owner", now: NOW,
    })).rejects.toThrow("session has not started");
    expect(tables.scheduled_session[0].status).toBe("scheduled");
  });

  it("allows cancelling a future session", async () => {
    const tables = seed();
    tables.scheduled_session[0].starts_at = "2026-09-10T16:00:00.000Z";
    await markSession(fakeDb(tables), { sessionId: "session-1", status: "cancelled", userId: "owner", now: NOW });
    expect(tables.scheduled_session[0].status).toBe("cancelled");
  });

  it("records attendance even if drafting is denied and retries the offer on a later sweep", async () => {
    denyDrafting();
    const tables = seed();
    const db = fakeDb(tables);
    expect(await markSession(db, { sessionId: "session-1", status: "no_show", userId: "owner", now: NOW }))
      .toEqual({ status: "no_show", rescheduleDrafted: false });
    expect(tables.client_message_draft).toHaveLength(0);
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
    expect(await sweepNoShows(db, { now: NOW })).toEqual({ drafted: 1, skipped: 0 });
  });

  it("does not duplicate a sweep's offer when manually marked no-show", async () => {
    const tables = seed();
    const db = fakeDb(tables);
    await sweepNoShows(db, { now: NOW });
    expect(await markSession(db, { sessionId: "session-1", status: "no_show", userId: "owner", now: NOW }))
      .toEqual({ status: "no_show", rescheduleDrafted: false });
    expect(tables.client_message_draft).toHaveLength(1);
  });

  it.each(["completed", "cancelled"] as const)("clears the slot proposal when marked %s", async (status) => {
    const tables = seed();
    const db = fakeDb(tables);
    await sweepNoShows(db, { now: NOW });
    await markSession(db, { sessionId: "session-1", status, userId: "owner", now: NOW });
    expect(tables.scheduled_session[0].slot_reopening_proposed_at).toBeNull();
  });
});
