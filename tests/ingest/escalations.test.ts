import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV4 } from "ai/test";
import { runIngest } from "@/lib/ingest/run";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const orgA = "00000000-0000-0000-0000-00000000000a";
const clientA = "00000000-0000-0000-0000-0000000000c1";

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

const owned = {
  text: "Send the revised deck", owner: "Priya", deadline: "2026-08-14",
  type: "deliverable", confidence: "high", source_span: "I'll send the revised deck",
};

let db: SupabaseClient;
beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

async function escalationsFor(conversationId: string) {
  const { data } = await db.from("escalation").select("*").eq("conversation_id", conversationId);
  return data ?? [];
}

const base = {
  orgId: orgA, clientId: clientA, clientName: "Ramirez family",
  title: "Escalation check", occurredAt: "2026-08-11",
};

describe("runIngest escalations", () => {
  it("raises nothing for a clean conversation", async () => {
    const r = await runIngest(db, {
      ...base, transcript: "Consultant: I'll send the revised deck by Friday.",
    }, mockReturning({ commitments: [owned], subject: "Deck", body: "On its way." }));

    expect(await escalationsFor(r.conversationId)).toEqual([]);
  });

  it("raises a complaint and links it to the conversation, not a commitment", async () => {
    const r = await runIngest(db, {
      ...base,
      transcript: "Client: I'm disappointed with last month. Consultant: I'll send the revised deck.",
    }, mockReturning({ commitments: [owned], subject: "Deck", body: "On its way." }));

    const rows = await escalationsFor(r.conversationId);
    const complaint = rows.find((e) => e.kind === "complaint");
    expect(complaint).toBeDefined();
    expect(complaint!.commitment_id).toBeNull();
    expect(complaint!.state).toBe("open");
  });

  it("links a missing-owner escalation to the commitment it is about", async () => {
    const r = await runIngest(db, {
      ...base, transcript: "Someone will send the deck.",
    }, mockReturning({
      commitments: [{ ...owned, owner: null, deadline: null }],
      subject: "Deck", body: "On its way.",
    }));

    const rows = await escalationsFor(r.conversationId);
    const missing = rows.find((e) => e.kind === "missing_owner_or_deadline");
    expect(missing).toBeDefined();
    expect(missing!.commitment_id).not.toBeNull();

    const { data: commitment } = await db.from("commitment").select("id")
      .eq("id", missing!.commitment_id).single();
    expect(commitment).not.toBeNull();
  });

  it("writes an agent-actor audit row when it escalates", async () => {
    const r = await runIngest(db, {
      ...base, transcript: "Client: My attorney will be in touch. I'll send the signed copy.",
    }, mockReturning({ commitments: [owned], subject: "Deck", body: "On its way." }));

    const { data } = await db.from("audit_event").select("*")
      .eq("target", `conversation:${r.conversationId}:escalate`);
    expect(data!.length).toBe(1);
    expect(data![0].actor).toBe("agent");
  });

  it("does not stack duplicates when extraction is retried", async () => {
    const model = mockReturning({
      commitments: [{ ...owned, owner: null }], subject: "Deck", body: "On its way.",
    });
    const r = await runIngest(db, {
      ...base, transcript: "Client: I'm frustrated. Someone will send the deck.",
    }, model);
    const first = await escalationsFor(r.conversationId);

    const { retryExtractionFor } = await import("@/lib/ingest/run");
    await retryExtractionFor(db, r.transcriptId, model);

    const second = await escalationsFor(r.conversationId);
    expect(second.filter((e) => e.state === "open").map((e) => e.kind).sort())
      .toEqual(first.filter((e) => e.state === "open").map((e) => e.kind).sort());
  });
});
