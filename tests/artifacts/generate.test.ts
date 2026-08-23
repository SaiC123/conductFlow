import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { generateDocument, generateCalendarEvent, type ArtifactDeps } from "@/lib/artifacts/generate";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let db: SupabaseClient;
beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

/** Records what the Google clients were asked to do, without asking Google. */
function spyDeps(templateText: string) {
  const calls = {
    copied: [] as { fileId: string; title: string }[],
    replaced: [] as { literal: string; value: string }[][],
    events: [] as { title: string; description?: string }[],
  };
  const deps: ArtifactDeps = {
    readTemplate: async () => templateText,
    docs: {
      async copyTemplate(fileId, title) {
        calls.copied.push({ fileId, title });
        return { id: "doc-1", name: title, url: "https://docs.google.com/document/d/doc-1/edit" };
      },
      async replaceTokens(_id, replacements) { calls.replaced.push(replacements); },
    },
    calendar: {
      async createEvent(event) {
        calls.events.push({ title: event.title, description: event.description });
        return { id: "evt-1", url: "https://calendar.google.com/x" };
      },
    },
  };
  return { deps, calls };
}

async function orgWithTemplate(role: string | null, name = "Proposal template") {
  const orgId = randomUUID();
  const { error: orgError } = await db.from("organization")
    .insert({ id: orgId, name: "Artifact Org" });
  if (orgError) throw orgError;

  if (role !== null) {
    const { error } = await db.from("drive_template").insert({
      org_id: orgId, file_id: `file-${randomUUID()}`, name,
      mime_type: "application/vnd.google-apps.document", state: "active", role,
    });
    if (error) throw error;
  }
  return orgId;
}

describe("generateDocument", () => {
  it("copies the bound template and substitutes into the copy", async () => {
    const orgId = await orgWithTemplate("proposal");
    const { deps, calls } = spyDeps("Proposal for {{client_name}}, fee {{fee}}.");

    const r = await generateDocument(db, orgId, {
      role: "proposal", title: "Acme proposal",
      values: { client_name: "Acme", fee: "£4,000" },
    }, deps);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.document.url).toContain("doc-1");
    expect(calls.copied[0].title).toBe("Acme proposal");
    expect(calls.replaced[0]).toEqual([
      { literal: "{{client_name}}", value: "Acme" },
      { literal: "{{fee}}", value: "£4,000" },
    ]);
  });

  it("blocks when the org has bound no template for the role", async () => {
    const orgId = await orgWithTemplate(null);
    const { deps, calls } = spyDeps("irrelevant");

    const r = await generateDocument(db, orgId, {
      role: "proposal", title: "t", values: {},
    }, deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_template");
    expect(calls.copied).toHaveLength(0);
  });

  // The reason the validation pass runs before the copy: a blocked generation must not
  // leave an empty document in the owner's Drive for somebody to notice and delete.
  it("creates nothing at all when a token has no value", async () => {
    const orgId = await orgWithTemplate("proposal");
    const { deps, calls } = spyDeps("Starts {{start_date}}");

    const r = await generateDocument(db, orgId, {
      role: "proposal", title: "t", values: { client_name: "Acme" },
    }, deps);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("missing_tokens");
      expect(r.missing).toEqual(["start_date"]);
      expect(r.detail).toContain("Proposal template");
    }
    expect(calls.copied).toHaveLength(0);
    expect(calls.replaced).toHaveLength(0);
  });

  it("passes the literal spelling through, so a spaced token still substitutes", async () => {
    const orgId = await orgWithTemplate("proposal");
    const { deps, calls } = spyDeps("Hello {{ client_name }}");

    await generateDocument(db, orgId, {
      role: "proposal", title: "t", values: { client_name: "Acme" },
    }, deps);

    expect(calls.replaced[0]).toEqual([{ literal: "{{ client_name }}", value: "Acme" }]);
  });

  it("ignores a template row the org removed", async () => {
    const orgId = await orgWithTemplate("proposal");
    const { error } = await db.from("drive_template")
      .update({ state: "removed" }).eq("org_id", orgId);
    if (error) throw error;

    const r = await generateDocument(db, orgId, {
      role: "proposal", title: "t", values: {},
    }, spyDeps("x").deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_template");
  });

  it("does not read another org's template", async () => {
    await orgWithTemplate("proposal");
    const bare = await orgWithTemplate(null);

    const r = await generateDocument(db, bare, {
      role: "proposal", title: "t", values: {},
    }, spyDeps("x").deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_template");
  });
});

describe("generateCalendarEvent", () => {
  it("takes the title from the first line and the description from the rest", async () => {
    const orgId = await orgWithTemplate("calendar", "Calendar template");
    const { deps, calls } = spyDeps("Follow-up with {{client_name}}\nAgreed on {{date}}.");

    const r = await generateCalendarEvent(db, orgId, {
      values: { client_name: "Acme", date: "3 March" },
      start: "2026-03-03T10:00:00Z", end: "2026-03-03T10:30:00Z",
      fallbackTitle: "Follow-up",
    }, deps);

    expect(r.ok).toBe(true);
    expect(calls.events[0].title).toBe("Follow-up with Acme");
    expect(calls.events[0].description).toBe("Agreed on 3 March.");
  });

  it("blocks on a missing token rather than creating a half-titled event", async () => {
    const orgId = await orgWithTemplate("calendar", "Calendar template");
    const { deps, calls } = spyDeps("Follow-up with {{client_name}}");

    const r = await generateCalendarEvent(db, orgId, {
      values: {}, start: "2026-03-03T10:00:00Z", end: "2026-03-03T10:30:00Z",
      fallbackTitle: "Follow-up",
    }, deps);

    expect(r.ok).toBe(false);
    expect(calls.events).toHaveLength(0);
  });

  it("falls back to the given title when the template is blank", async () => {
    const orgId = await orgWithTemplate("calendar", "Calendar template");
    const { deps, calls } = spyDeps("   \n  ");

    const r = await generateCalendarEvent(db, orgId, {
      values: {}, start: "2026-03-03T10:00:00Z", end: "2026-03-03T10:30:00Z",
      fallbackTitle: "Follow-up",
    }, deps);

    expect(r.ok).toBe(true);
    expect(calls.events[0].title).toBe("Follow-up");
  });
});
