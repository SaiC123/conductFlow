import { describe, it, expect, vi, afterEach } from "vitest";
import { STARTER_TEMPLATES, starterFor } from "@/lib/google/starter-templates";
import { isSelectableAsTemplate } from "@/lib/google/picker";
import { tokensIn, tokenMatchesIn, fillTemplate } from "@/lib/artifacts/tokens";
import {
  buildTokenValues, moneyPassThroughFor, AVAILABLE_TOKENS, isMoneyToken,
} from "@/lib/artifacts/values";
import { createDocsWriteClient } from "@/lib/google/docs";

/** The leanest conversation the ingest path can hand a template: one promise, no figures. */
function minimalValues() {
  return buildTokenValues({
    clientName: "BrightPath",
    conversationTitle: "Scope call",
    occurredAt: "2026-08-24",
    commitments: [{
      text: "Send the revised scope document",
      owner: null, deadline: null, type: "deliverable" as const,
      confidence: "high" as const, source_span: "I'll send the revised scope over",
      span_verified: true,
    }],
    today: "2026-08-25",
  });
}

describe("starter templates", () => {
  it("only asks for tokens the value builder can supply", () => {
    for (const starter of STARTER_TEMPLATES) {
      for (const token of tokensIn(starter.body)) {
        expect(
          (AVAILABLE_TOKENS as readonly string[]).includes(token) || isMoneyToken(token),
          `${starter.role} template asks for {{${token}}}`,
        ).toBe(true);
      }
    }
  });

  /**
   * The one that matters. A starter template that blocks its own first generation would be
   * worse than no template at all — the owner would have done everything asked of them and
   * still get "this conversation did not establish it".
   */
  it("fills from a conversation with no deadline, no owner and no figures", () => {
    const values = minimalValues();
    for (const starter of STARTER_TEMPLATES) {
      const withMoney = {
        ...moneyPassThroughFor(tokenMatchesIn(starter.body)),
        ...values,
      };
      const filled = fillTemplate(starter.body, withMoney);
      expect(filled.ok, `${starter.role}: missing ${JSON.stringify(
        filled.ok ? [] : filled.missing)}`).toBe(true);
    }
  });

  it("leaves a money token visible rather than inventing a figure", () => {
    const proposal = starterFor("proposal");
    expect(proposal).toBeDefined();
    const body = proposal!.body;
    const filled = fillTemplate(body, {
      ...moneyPassThroughFor(tokenMatchesIn(body)),
      ...minimalValues(),
    });
    expect(filled.ok && filled.text).toContain("{{fee}}");
  });

  it("names files the drafting path will actually consider", () => {
    for (const starter of STARTER_TEMPLATES) {
      expect(isSelectableAsTemplate(starter.name)).toBe(true);
    }
  });

  it("puts a real title on the calendar template's first line", () => {
    const calendar = starterFor("calendar");
    const [first] = calendar!.body.split("\n");
    expect(first.trim()).not.toBe("");
    // generateCalendarEvent takes the first non-blank line as the title and drops the rest
    // into the description, so a leading blank line would silently retitle the event.
    expect(first).toContain("{{client_name}}");
  });
});

describe("createTextDocument", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uploads the body as a Google Doc in one multipart request", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        id: "doc1", name: "ConductFlow proposal template",
        webViewLink: "https://docs.google.com/document/d/doc1/edit",
      }), { status: 200 });
    });

    const created = await createDocsWriteClient("tok")
      .createTextDocument("ConductFlow proposal template", "Proposal for {{client_name}}");

    expect(created).toEqual({
      id: "doc1",
      name: "ConductFlow proposal template",
      url: "https://docs.google.com/document/d/doc1/edit",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/upload/drive/v3/files");
    expect(calls[0].url).toContain("uploadType=multipart");

    const body = String(calls[0].init.body);
    // The metadata part is what makes Drive convert the upload instead of storing a .txt.
    expect(body).toContain("application/vnd.google-apps.document");
    expect(body).toContain("Proposal for {{client_name}}");
    expect(body).toContain("charset=UTF-8");
  });

  it("says which call failed rather than returning a document that does not exist", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 403 }));
    await expect(createDocsWriteClient("tok").createTextDocument("t", "b"))
      .rejects.toThrow(/files.create failed: 403/);
  });
});
