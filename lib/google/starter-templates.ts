import type { TemplateRole } from "./templates";

/**
 * Templates ConductFlow can write into an owner's Drive itself, so binding a template does
 * not depend on the Google Picker.
 *
 * The Picker needs three things to line up in the Google Cloud Console â€” an OAuth client
 * with the page's origin registered, a browser API key from the *same* project, and the
 * Picker API enabled on it â€” and none of them are visible from inside the app when they are
 * wrong. Creating a file needs none of that: `drive.file` already covers a file the app
 * created, which is the same grant the copy-and-substitute path in lib/artifacts/generate.ts
 * relies on afterwards. An org can go from a fresh Google connection to a working proposal
 * without a Console ever being opened.
 *
 * These are starting points, not fixed forms. The file lands in the owner's Drive and is
 * theirs to rewrite; only the `{{token}}` names have to survive editing.
 */
export interface StarterTemplate {
  role: TemplateRole;
  /** Contains "template" on purpose â€” loadTemplate() in lib/google/context.ts filters on it. */
  name: string;
  body: string;
}

/**
 * Every token used below is one `buildTokenValues` always produces a non-empty value for.
 * That rule is what keeps a starter template from blocking its own first generation:
 * `{{owners}}`, `{{next_deadline}}` and `{{amounts}}` are all legitimately null when a
 * conversation did not establish them, and `fillTemplate` blocks the whole artifact on a
 * null. `{{fee}}` is the deliberate exception â€” a money token passes through as its own
 * literal, so it survives into the document for an owner to fill in by hand.
 */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    role: "proposal",
    name: "ConductFlow proposal template",
    body: [
      "Proposal for {{client_name}}",
      "",
      "Prepared {{today}}, from the conversation on {{conversation_date}}.",
      "",
      "What was agreed",
      "{{commitment_list}}",
      "",
      "Scope",
      "Replace this paragraph with the work being quoted for.",
      "",
      "Fee",
      "{{fee}}",
      "",
      "Next steps",
      "Reply to confirm and the dates above hold.",
      "",
      "â€”",
      "Anything in double braces is filled in from the conversation. Everything else is",
      "yours to rewrite.",
    ].join("\n"),
  },
  {
    role: "calendar",
    name: "ConductFlow calendar template",
    // First non-blank line becomes the event title and the rest the description â€” the
    // convention lib/artifacts/generate.ts documents. Keep the title on line one.
    body: [
      "Follow up: {{client_name}}",
      "",
      "From \"{{conversation_title}}\" on {{conversation_date}}.",
      "",
      "What was promised:",
      "{{commitment_list}}",
    ].join("\n"),
  },
];

/** Plain text on the way up; Drive converts it to a Google Doc on arrival. */
export const STARTER_MIME_TYPE = "text/plain";

export function starterFor(role: TemplateRole): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.role === role);
}
