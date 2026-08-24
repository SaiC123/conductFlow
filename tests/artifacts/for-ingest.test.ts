import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { generateArtifactsForConversation } from "@/lib/artifacts/for-ingest";
import type { ArtifactCapabilities } from "@/lib/artifacts/deps";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const JWT_SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);

let db: SupabaseClient;
beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

/**
 * A client for a signed-in member of `orgId` — the role the ingest path actually runs as
 * in production, where the Server Action hands `runIngest` the cookie-scoped client from
 * getServerClient(). Every other test here injects a service-role client, which bypasses
 * RLS; only this one sees what a browser-driven ingest sees.
 */
async function memberClient(orgId: string): Promise<SupabaseClient> {
  const userId = randomUUID();
  const { error: u } = await db.from("app_user")
    .insert({ id: userId, email: `${userId}@example.test` });
  if (u) throw u;
  const { error: m } = await db.from("membership")
    .insert({ user_id: userId, org_id: orgId, role: "owner" });
  if (m) throw m;

  const token = await new SignJWT({ sub: userId, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime("1h").sign(JWT_SECRET);
  return createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

const COMMITMENTS = [{
  text: "Send the revised scope", owner: "Consultant", deadline: "2026-09-01",
  type: "deliverable" as const, confidence: "high" as const, source_span: "I'll send the scope",
  span_verified: true,
}];

function capabilities(templateText: string, opts?: {
  driveReady?: boolean; calendarReady?: boolean; failDocs?: boolean;
}) {
  const calls = { copied: 0, events: 0 };
  const caps: ArtifactCapabilities = {
    driveReady: opts?.driveReady ?? true,
    calendarReady: opts?.calendarReady ?? true,
    deps: {
      readTemplate: async () => templateText,
      docs: {
        async copyTemplate(_fileId, title) {
          if (opts?.failDocs) throw new Error("Drive files.copy failed: 403");
          calls.copied += 1;
          return { id: "doc-1", name: title, url: "https://docs.google.com/document/d/doc-1/edit" };
        },
        async replaceTokens() {},
      },
      calendar: {
        async createEvent() {
          calls.events += 1;
          return { id: "evt-1", url: "https://calendar.google.com/evt-1" };
        },
      },
    },
  };
  return { caps, calls };
}

/** A fresh org with a conversation, plus templates bound to the roles named. */
async function scenario(roles: string[]) {
  const orgId = randomUUID();
  const clientId = randomUUID();
  const conversationId = randomUUID();

  const { error: o } = await db.from("organization").insert({ id: orgId, name: "Artifact Org" });
  if (o) throw o;
  const { error: c } = await db.from("client_contact")
    .insert({ id: clientId, org_id: orgId, name: "Acme" });
  if (c) throw c;
  const { error: v } = await db.from("conversation")
    .insert({ id: conversationId, org_id: orgId, client_id: clientId, title: "Kickoff" });
  if (v) throw v;

  for (const role of roles) {
    const { error } = await db.from("drive_template").insert({
      org_id: orgId, file_id: `file-${randomUUID()}`, name: `${role} template`,
      mime_type: "application/vnd.google-apps.document", state: "active", role,
    });
    if (error) throw error;
  }
  return { orgId, conversationId };
}

const args = (orgId: string, conversationId: string) => ({
  orgId, conversationId, clientName: "Acme", title: "Kickoff",
  occurredAt: "2026-08-20", commitments: COMMITMENTS,
  contract: blueprintToContract(DEFAULT_BLUEPRINT),
});

async function artifactRows(orgId: string) {
  const { data } = await db.from("generated_artifact")
    .select("kind,outcome,url,detail").eq("org_id", orgId);
  return data ?? [];
}

describe("generateArtifactsForConversation", () => {
  it("creates a document and an event, and records both", async () => {
    const { orgId, conversationId } = await scenario(["proposal", "calendar"]);
    const { caps, calls } = capabilities("For {{client_name}} on {{conversation_date}}");

    const r = await generateArtifactsForConversation(db, args(orgId, conversationId), caps);

    expect(r.documentUrl).toContain("doc-1");
    expect(r.eventUrl).toContain("evt-1");
    expect(r.blocked).toEqual([]);
    expect(calls).toEqual({ copied: 1, events: 1 });

    const rows = await artifactRows(orgId);
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.outcome === "created")).toBe(true);
  });

  // The default blueprint ships both actions on. An owner who turns them off gets nothing,
  // and that is the blueprint working rather than a failure to report.
  it("creates nothing when the blueprint turns both actions off", async () => {
    const { orgId, conversationId } = await scenario(["proposal", "calendar"]);
    const { caps, calls } = capabilities("For {{client_name}}");

    const r = await generateArtifactsForConversation(db, {
      ...args(orgId, conversationId),
      contract: blueprintToContract({
        ...DEFAULT_BLUEPRINT,
        permitted_actions: ["draft_recap"],
        required_approvals: [],
      }),
    }, caps);

    expect(r).toEqual({ documentUrl: null, eventUrl: null, blocked: [] });
    expect(calls).toEqual({ copied: 0, events: 0 });
    expect(await artifactRows(orgId)).toHaveLength(0);
  });

  it("records a blocked document when no template is bound, and still makes the event", async () => {
    const { orgId, conversationId } = await scenario(["calendar"]);
    const { caps, calls } = capabilities("Follow up with {{client_name}}");

    const r = await generateArtifactsForConversation(db, args(orgId, conversationId), caps);

    expect(r.documentUrl).toBeNull();
    expect(r.eventUrl).toContain("evt-1");
    expect(r.blocked.join(" ")).toMatch(/No proposal template is bound/);
    expect(calls.copied).toBe(0);

    const rows = await artifactRows(orgId);
    expect(rows.find((x) => x.kind === "document")?.outcome).toBe("no_template");
    expect(rows.find((x) => x.kind === "calendar_event")?.outcome).toBe("created");
  });

  // A money token is the one kind that does not block. ConductFlow records no amounts, but
  // refusing to produce the document was worse than producing one an owner finishes by hand.
  it("still creates the document when a money token has no value", async () => {
    const { orgId, conversationId } = await scenario(["proposal"]);
    const { caps, calls } = capabilities("Fee for {{client_name}} is {{fee}}",
      { calendarReady: false });

    const r = await generateArtifactsForConversation(db, args(orgId, conversationId), caps);

    expect(r.documentUrl).toContain("doc-1");
    expect(calls.copied).toBe(1);
    expect(r.blocked).toEqual([]);

    const rows = await artifactRows(orgId);
    expect(rows.find((x) => x.kind === "document")?.outcome).toBe("created");
  });

  it("puts the figures that were actually said into {{amounts}}", async () => {
    const { orgId, conversationId } = await scenario(["proposal"]);
    const { caps } = capabilities("Agreed:\n{{amounts}}", { calendarReady: false });
    let replaced: { literal: string; value: string }[] = [];
    caps.deps.docs = {
      async copyTemplate(_f, title) {
        return { id: "doc-1", name: title, url: "https://docs.google.com/document/d/doc-1/edit" };
      },
      async replaceTokens(_id, r) { replaced = r; },
    };

    await generateArtifactsForConversation(db, {
      ...args(orgId, conversationId),
      amounts: [
        { label: "monthly services", amount: "$1,250 per month", source_span: "x" },
        { label: "advertising budget", amount: "$400", source_span: "y" },
      ],
    }, caps);

    expect(replaced[0].value)
      .toBe("• monthly services: $1,250 per month\n• advertising budget: $400");
  });

  // A template asking for a figure when none was discussed still blocks: an empty list would
  // read as "nothing was agreed", which is a claim rather than an absence.
  it("blocks on {{amounts}} when the conversation discussed no money", async () => {
    const { orgId, conversationId } = await scenario(["proposal"]);
    const { caps, calls } = capabilities("Agreed: {{amounts}}", { calendarReady: false });

    const r = await generateArtifactsForConversation(db, args(orgId, conversationId), caps);

    expect(r.documentUrl).toBeNull();
    expect(calls.copied).toBe(0);
  });

  it("skips the calendar entirely when the org has not granted it", async () => {
    const { orgId, conversationId } = await scenario(["proposal", "calendar"]);
    const { caps, calls } = capabilities("For {{client_name}}", { calendarReady: false });

    const r = await generateArtifactsForConversation(db, args(orgId, conversationId), caps);

    expect(r.eventUrl).toBeNull();
    expect(calls.events).toBe(0);
    // Not a blocked artifact: the org never asked for calendar writing.
    expect(r.blocked).toEqual([]);
    expect(await artifactRows(orgId)).toHaveLength(1);
  });

  // The whole module is best-effort: a Google outage must not undo a good extraction.
  it("does not throw when Google fails, and records the failure", async () => {
    const { orgId, conversationId } = await scenario(["proposal"]);
    const { caps } = capabilities("For {{client_name}}",
      { failDocs: true, calendarReady: false });

    const r = await generateArtifactsForConversation(db, args(orgId, conversationId), caps);

    expect(r.documentUrl).toBeNull();
    expect(r.blocked.join(" ")).toMatch(/403/);
    expect((await artifactRows(orgId))[0].outcome).toBe("failed");
  });

  // Regression: the ingest path hands this function the cookie-scoped `authenticated`
  // client, not a service-role one, and `generated_artifact` grants insert to service_role
  // alone. Every other test here injects a service-role client, which bypasses RLS and so
  // could never catch that the audit rows were being silently dropped in production.
  it("records artifacts even when the caller's client cannot write the table", async () => {
    const { orgId, conversationId } = await scenario(["proposal", "calendar"]);
    const { caps } = capabilities("For {{client_name}} on {{conversation_date}}");

    const asMember = await memberClient(orgId);
    const r = await generateArtifactsForConversation(asMember, args(orgId, conversationId), caps);

    expect(r.documentUrl).toContain("doc-1");
    expect(await artifactRows(orgId)).toHaveLength(2);
  });

  it("puts the event on the soonest deadline the conversation carried", async () => {
    const { orgId, conversationId } = await scenario(["calendar"]);
    let seen: { start: string } | null = null;
    const { caps } = capabilities("Follow up with {{client_name}}", { driveReady: false });
    caps.deps.calendar = {
      async createEvent(event) {
        seen = { start: event.start };
        return { id: "evt-1", url: "https://calendar.google.com/evt-1" };
      },
    };

    await generateArtifactsForConversation(db, args(orgId, conversationId), caps);

    expect(seen!.start).toBe("2026-09-01T09:00:00Z");
  });
});
