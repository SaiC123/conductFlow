import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTemplate, type TemplateRole, type ResolvedTemplate } from "@/lib/google/templates";
import { fillTemplate, tokenMatchesIn, describeMissing } from "./tokens";
import { moneyPassThroughFor } from "./values";
import type { DocsWriteClient, CreatedDocument } from "@/lib/google/docs";
import type { CalendarWriteClient, CreatedEvent } from "@/lib/google/calendar-write";

/**
 * Why a generation did not happen. Both are ordinary outcomes an owner can fix, not faults:
 * an org that has bound no proposal template has not agreed to ConductFlow inventing one,
 * and a conversation that never established a fee cannot produce a document quoting it.
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
  if (!template) {
    return {
      ok: false,
      reason: "no_template",
      detail: `No ${args.role} template is bound. Pick one in Settings and give it the ${args.role} role.`,
    };
  }

  const text = await deps.readTemplate(template);
  const values = withMoneyPassThrough(text, args.values);
  const filled = fillTemplate(text, values);
  if (!filled.ok) {
    return {
      ok: false,
      reason: "missing_tokens",
      detail: `"${template.name}" was not used: ${describeMissing(filled.missing)}.`,
      missing: filled.missing,
    };
  }

  // Substitution happens twice against the same template text, and that is not redundant.
  // fillTemplate above decides whether this is allowed to proceed at all, working on the
  // exported plain text. The Docs API pass below is what actually edits the copy, and it
  // works on literals so the document keeps the template's formatting instead of being
  // rewritten as flat text.
  const document = await deps.docs.copyTemplate(template.fileId, args.title);
  await deps.docs.replaceTokens(document.id, tokenMatchesIn(text).map(({ literal, name }) => ({
    literal,
    value: String(values[name]).trim(),
  })));

  return { ok: true, document };
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
  const template = await resolveTemplate(db, orgId, "calendar");
  if (!template) {
    return {
      ok: false,
      reason: "no_template",
      detail: "No calendar template is bound. Pick one in Settings and give it the calendar role.",
    };
  }

  const text = await deps.readTemplate(template);
  const filled = fillTemplate(text, withMoneyPassThrough(text, args.values));
  if (!filled.ok) {
    return {
      ok: false,
      reason: "missing_tokens",
      detail: `"${template.name}" was not used: ${describeMissing(filled.missing)}.`,
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
