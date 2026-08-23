import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV4 } from "ai/test";
import { randomUUID } from "node:crypto";
import { runIngest, INGEST_STATS_ROW_LIMIT } from "@/lib/ingest/run";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const DAY_MS = 86_400_000;

function mockReturning(payload: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

let db: SupabaseClient;
beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

// A fresh org and client for this file only, so the row counts we seed are the only rows the
// exception checks see — no shared-fixture pollution from other suites, and no dependence on
// whatever the demo org (used by tests/ingest/run.test.ts and escalations.test.ts) happens to
// hold at the time this file runs.
describe("runIngest bounds the operations-map reads", () => {
  it("lets a stale outlier fall out of the org's lead-time baseline once history exceeds the row limit", async () => {
    const orgId = randomUUID();
    const clientId = randomUUID();
    const conversationId = randomUUID();
    const now = Date.now();

    const { error: orgError } = await db.from("organization")
      .insert({ id: orgId, name: "Bound Test Org" });
    if (orgError) throw orgError;
    const { error: clientError } = await db.from("client_contact")
      .insert({ id: clientId, org_id: orgId, name: "Bound Test Client" });
    if (clientError) throw clientError;
    const { error: convError } = await db.from("conversation")
      .insert({ id: conversationId, org_id: orgId, client_id: clientId, title: "seed" });
    if (convError) throw convError;

    // One ancient "meeting" commitment promised 900 days out. Left in the sample, it alone
    // stretches this org's observed lead time for "meeting" wide enough that nothing new
    // ever looks unusual. If the read that feeds buildOperationsMap is unbounded, this row
    // is still there no matter how much has happened since.
    const outlier = {
      org_id: orgId, conversation_id: conversationId, client_id: clientId,
      text: "ancient meeting", confidence: "high" as const, type: "meeting",
      created_at: new Date(now - 1000 * DAY_MS).toISOString(),
      deadline: new Date(now - 100 * DAY_MS).toISOString(), // created 1000 days ago, due in 900
      status: "done" as const,
    };
    // Enough recent "meeting" commitments, all with an ordinary 3-day lead time, to fill a
    // recency-ordered window of INGEST_STATS_ROW_LIMIT rows and push the outlier above out of it.
    const recentRows = Array.from({ length: INGEST_STATS_ROW_LIMIT }, (_, i) => {
      const createdAt = now - (i + 1) * 60_000;
      return {
        org_id: orgId, conversation_id: conversationId, client_id: clientId,
        text: `recent meeting ${i}`, confidence: "high" as const, type: "meeting",
        created_at: new Date(createdAt).toISOString(),
        deadline: new Date(createdAt + 3 * DAY_MS).toISOString(),
        status: "done" as const,
      };
    });
    const { error: seedError } = await db.from("commitment").insert([outlier, ...recentRows]);
    if (seedError) throw seedError;

    // A brand-new "meeting" promised 60 days out — ordinary next to the ancient outlier's
    // 900-day lead time, but wildly outside the 3-day norm the recent rows actually show.
    const farDeadline = new Date(now + 60 * DAY_MS).toISOString().slice(0, 10);
    const r = await runIngest(db, {
      orgId, clientId, clientName: "Bound Test Client",
      title: "New promise", occurredAt: new Date(now).toISOString().slice(0, 10),
      transcript: "Consultant: I'll meet with you again soon.",
    }, mockReturning({
      commitments: [{
        text: "Meet again", owner: "Consultant", deadline: farDeadline,
        type: "meeting", confidence: "high", source_span: "I'll meet with you again soon",
      }],
      subject: "Meeting", body: "On the calendar.",
    }));

    const { data: escalations } = await db.from("escalation")
      .select("kind").eq("conversation_id", r.conversationId);
    expect((escalations ?? []).map((e) => e.kind)).toContain("unusual_lead_time");
  });
});
