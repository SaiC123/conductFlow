import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTemplate, type TemplateRole, type ResolvedTemplate } from "@/lib/google/templates";
import { fillTemplate, tokenMatchesIn, describeMissing } from "./tokens";
import { moneyPassThroughFor } from "./values";
import { starterFor } from "@/lib/google/starter-templates";
import type { DocsWriteClient, DocsCreateClient, CreatedDocument } from "@/lib/google/docs";
import type { CalendarWriteClient, CreatedEvent } from "@/lib/google/calendar-write";

/**
 * Why a generation did not happen. Both are ordinary outcomes an owner can fix, not faults:
 * an org that has bound no template and cannot be given the built-in one has nothing to
 * generate from, and a conversation that never established a fee cannot produce a document
 * quoting it.
 */
export type BlockedReason = "no_template" | "missing_tokens";

export interface GenerationBlocked {
  ok: false;
  reason: BlockedReason;
  /** Ready to show an owner. Never a stack trace. */
  detail: string;
  /** Populated when `reason` is "missing_tokens". */
  missing?: string[];
}

export type DocumentResult = { ok: true; document: CreatedDocument } | GenerationBlocked;
export type EventResult = { ok: true; event: CreatedEvent } | GenerationBlocked;

/**
 * Injected rather than constructed here so the generation logic can be tested without a
 * Google account. The real wiring builds these from an access token in the ingest path.
 */
export interface ArtifactDeps {
  /** Reads the bound template's text. The existing read-only DriveClient does this. */
  readTemplate(template: ResolvedTemplate): Promise<string>;
  docs: DocsWriteClient;
  calendar: CalendarWriteClient;
  /**
   * Writes a document from text rather than by copying a file. Only used when the org has
   * bound no template and ConductFlow falls back to its own — see `builtInBody`. Optional
   * so a caller that only wants the bound-template path does not have to supply one; when
   * it is absent, an unbound role blocks exactly as it always did.
   */
  docsCreate?: DocsCreateClient;
}

export type TokenValues = Record<string, string | null | undefined>;

/**
 * Copies the template bound to `role` and substitutes the values into the copy.
 *
 * Order matters and is deliberate: the template is read and validated *before* anything is
 * created. A template asking for a value this conversation never established produces no
 * file at all, rather than an empty document in the owner's Drive that somebody has to
 * notice and delete.
 */
export async function generateDocument(
  db: SupabaseClient,
  orgId: string,
  args: { role: TemplateRole; title: string; values: TokenValues },
  deps: ArtifactDeps,
): Promise<DocumentResult> {
  const template = await resolveTemplate(db, orgId, args.role);
  // The built-in body has no file to copy, so it needs a client that can write a new one.
  // Without that, an unbound role blocks exactly as it did before.
  if (!template && !deps.docsCreate) return unbound(args.role, deps);

  const source = await sourceFor(template, args.role, deps);
  if (!source) return unbound(args.role, deps);

  const values = withMoneyPassThrough(source.text, args.values);
  const filled = fillTemplate(source.text, values);
  if (!filled.ok) {
    return {
      ok: false,
      reason: "missing_tokens",
      detail: `"${source.name}" was not used: ${describeMissing(filled.missing)}.`,
      missing: filled.missing,
    };
  }

  // Nothing to copy when the text is ConductFlow's own, so the already-substituted document
  // is written in one upload. Formatting is not lost in the way it would be for a real
  // template — the built-in body is plain text to begin with.
  if (!template) {
    const document = await deps.docsCreate!.createTextDocument(args.title, filled.text);
    return { ok: true, document };
  }

  // Substitution happens twice against the same template text, and that is not redundant.
  // fillTemplate above decides whether this is allowed to proceed at all, working on the
  // exported plain text. The Docs API pass below is what actually edits the copy, and it
  // works on literals so the document keeps the template's formatting instead of being
  // rewritten as flat text.
  const document = await deps.docs.copyTemplate(template.fileId, args.title);
  await deps.docs.replaceTokens(document.id, tokenMatchesIn(source.text)
    .map(({ literal, name }) => ({ literal, value: String(values[name]).trim() })));

  return { ok: true, document };
}

/**
 * The text a generation will fill, and what to call it in a message to an owner.
 *
 * A bound template wins. Failing that ConductFlow uses its own body for the role, which is
 * the difference between an org that has been through the Google Picker and one that has
 * not: binding a template is now a way to *change* what gets produced rather than the
 * precondition for producing anything. An owner who wants their own wording still gets it;
 * an owner who has not got that far gets a document instead of an explanation.
 */
async function sourceFor(
  template: ResolvedTemplate | null,
  role: TemplateRole,
  deps: ArtifactDeps,
): Promise<{ text: string; name: string } | null> {
  if (template) {
    return { text: await deps.readTemplate(template), name: template.name };
  }
  const starter = starterFor(role);
  // Document roles need somewhere to put the result; an event does not, which is why the
  // calendar path passes a `deps` whose `docsCreate` it never uses.
  if (!starter) return null;
  return { text: starter.body, name: `ConductFlow's built-in ${role} wording` };
}

function unbound(role: TemplateRole, deps: ArtifactDeps): GenerationBlocked {
  const detail = deps.docsCreate
    ? `ConductFlow has no built-in ${role} wording, so a template has to be bound. `
      + `Add one in Settings and give it the ${role} role.`
    : `No ${role} template is bound. Pick one in Settings and give it the ${role} role.`;
  return { ok: false, reason: "no_template", detail };
}

/**
 * Creates a calendar event whose title and description come from the bound calendar
 * template, with the same block-on-missing rule as a document.
 *
 * The event carries no guests. See lib/google/calendar-write.ts for why that is the whole
 * point rather than an omission.
 */
export async function generateCalendarEvent(
  db: SupabaseClient,
  orgId: string,
  args: { values: TokenValues; start: string; end: string; fallbackTitle: string },
  deps: ArtifactDeps,
): Promise<EventResult> {
  // An event needs no Drive file at all when the wording is ConductFlow's own, which is the
  // whole point: a calendar template used to be required for a calendar event, and an org
  // that granted only calendar access could never produce one.
  const template = await resolveTemplate(db, orgId, "calendar");
  const source = await sourceFor(template, "calendar", deps);
  if (!source) return unbound("calendar", deps);

  const text = source.text;
  const filled = fillTemplate(text, withMoneyPassThrough(text, args.values));
  if (!filled.ok) {
    return {
      ok: false,
      reason: "missing_tokens",
      detail: `"${source.name}" was not used: ${describeMissing(filled.missing)}.`,
      missing: filled.missing,
    };
  }

  // First non-blank line is the event title, the rest is the description. A calendar
  // template is a couple of lines, and asking an owner to learn a front-matter syntax to
  // write two fields would be worse than the convention.
  const lines = filled.text.split("\n");
  const titleIndex = lines.findIndex((l) => l.trim() !== "");
  const title = titleIndex === -1 ? args.fallbackTitle : lines[titleIndex].trim();
  const description = titleIndex === -1 ? "" : lines.slice(titleIndex + 1).join("\n").trim();

  const event = await deps.calendar.createEvent({
    title,
    start: args.start,
    end: args.end,
    description: description || undefined,
  });

  return { ok: true, event };
}

/**
 * A money token stands for itself, so a template quoting a fee still produces a document
 * with the placeholder left visible rather than refusing to produce one at all.
 */
function withMoneyPassThrough(template: string, values: TokenValues): TokenValues {
  return { ...moneyPassThroughFor(tokenMatchesIn(template)), ...values };
}
