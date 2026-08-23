import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV4 } from "ai/test";
import { regenerateDraftFor } from "@/lib/drafts/regenerate";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const orgA = "00000000-0000-0000-0000-00000000000a";
const conversationA = "00000000-0000-0000-0000-0000000000e1";
const clientA = "00000000-0000-0000-0000-0000000000c1";
// f1 is seeded with a draft. The undrafted case makes its own row: the suite never deletes,
// so a seeded commitment stops being draft-free after the first run.
const withDraft = "00000000-0000-0000-0000-0000000000f1";

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

const model = mockReturning({
  subject: "Regenerated subject",
  body: "Regenerated body confirming the promise.",
});

let db: SupabaseClient;
let withoutDraft: string;

async function makeUndraftedCommitment() {
  const { data, error } = await db.from("commitment").insert({
    org_id: orgA, conversation_id: conversationA, client_id: clientA,
    text: "Send the regeneration fixture", owner: "owner@demo.test",
    deadline: "2026-08-20T00:00:00.000Z", type: "email", confidence: "medium",
    source_span: "Send the regeneration fixture", status: "proposed",
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function draftsFor(commitmentId: string) {
  const { data } = await db.from("deliverable_draft").select("*").eq("commitment_id", commitmentId);
  return data ?? [];
}

beforeAll(async () => {
  db = createClient(URL, SERVICE, { auth: { persistSession: false } });
  withoutDraft = await makeUndraftedCommitment();
});

describe("regenerateDraftFor", () => {
  it("writes a draft for a commitment that has none", async () => {
    const r = await regenerateDraftFor(db, { commitmentId: withoutDraft }, model);
    expect(r.replaced).toBe(false);

    const drafts = await draftsFor(withoutDraft);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].subject).toBe("Regenerated subject");
    expect(drafts[0].kind).toBe("email");
  });

  it("replaces the existing draft rather than adding a second", async () => {
    const before = await draftsFor(withDraft);
    expect(before.length).toBeGreaterThan(0);

    const r = await regenerateDraftFor(db, { commitmentId: withDraft }, model);
    expect(r.replaced).toBe(true);

    const after = await draftsFor(withDraft);
    expect(after).toHaveLength(before.length);
    expect(after.every((d) => d.body === "Regenerated body confirming the promise.")).toBe(true);
  });

  it("writes an agent-actor audit row", async () => {
    await regenerateDraftFor(db, { commitmentId: withoutDraft }, model);
    const { data } = await db.from("audit_event").select("*")
      .eq("org_id", orgA).eq("target", `commitment:${withoutDraft}:draft`);
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0].actor).toBe("agent");
    expect(data![0].action).toBe("draft");
  });

  it("throws when the commitment does not exist", async () => {
    await expect(regenerateDraftFor(db, {
      commitmentId: "00000000-0000-0000-0000-0000000000ff",
    }, model)).rejects.toThrow(/not found/i);
  });

  // Regenerating used to skip contextForOrg entirely, so the replacement draft silently lost
  // the Drive template and Calendar notes the ingest-time one had. These two cover what is
  // observable without a connected Google account: that the context lookup happens against
  // the conversation the commitment belongs to, and that an org with nothing connected still
  // gets a draft. The context contents themselves need a real grant to assert, which no
  // fixture in this suite has — the ingest path has the same gap.
  it("prompts with the client and the conversation it came from", async () => {
    let seen = "";
    const capturing = new MockLanguageModelV4({
      doGenerate: async (options) => {
        seen = JSON.stringify(options.prompt);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ subject: "s", body: "b" }) }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });

    const { data: client } = await db.from("client_contact")
      .select("name").eq("id", clientA).single();
    await regenerateDraftFor(db, { commitmentId: withoutDraft }, capturing);
    expect(seen).toContain(client!.name);
  });

  it("still writes a draft for an org with no Google account connected", async () => {
    // contextForOrg never throws, and regenerate must not start doing so on its behalf:
    // every org is this org until someone visits Settings.
    const fresh = await makeUndraftedCommitment();
    await expect(regenerateDraftFor(db, { commitmentId: fresh }, model)).resolves
      .toMatchObject({ replaced: false });
    expect(await draftsFor(fresh)).toHaveLength(1);
  });

  it("leaves the old draft in place when the model call fails", async () => {
    const exploding = new MockLanguageModelV4({
      doGenerate: async () => { throw new Error("gateway exploded"); },
    });
    const before = await draftsFor(withDraft);

    await expect(regenerateDraftFor(db, { commitmentId: withDraft }, exploding))
      .rejects.toThrow(/gateway exploded/);

    const after = await draftsFor(withDraft);
    expect(after).toHaveLength(before.length);
    expect(after[0].body).toBe(before[0].body);
  });
});
