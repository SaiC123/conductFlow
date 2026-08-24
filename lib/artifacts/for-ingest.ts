import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentContract } from "@/lib/agent/contract";
import { canExecute } from "@/lib/agent/execute-policy";
import type { ExtractedCommitment, ExtractedAmount } from "@/lib/agent/schema";
import { buildTokenValues } from "./values";
import { generateDocument, generateCalendarEvent } from "./generate";
import { artifactCapabilitiesFor, type ArtifactCapabilities } from "./deps";
import { getServiceClient } from "@/lib/db/service";

/** Meetings default to half an hour; nothing in a transcript says how long one should be. */
const EVENT_MINUTES = 30;
const EVENT_HOUR_UTC = 9;

export interface ArtifactRunArgs {
  orgId: string;
  conversationId: string;
  clientName: string;
  title: string;
  /** YYYY-MM-DD, as typed into /ingest. */
  occurredAt: string;
  commitments: ExtractedCommitment[];
  /** Verified verbatim in lib/agent/extract.ts before they get here. */
  amounts?: ExtractedAmount[];
  contract: AgentContract;
}

export interface ArtifactRunResult {
  documentUrl: string | null;
  eventUrl: string | null;
  /** Sentences for the owner about anything that did not happen. */
  blocked: string[];
}

/**
 * Creates the Google artifacts one conversation earns, and records every outcome.
 *
 * Best-effort by construction, exactly like the exception checks it sits beside: an ingest
 * that extracted commitments correctly has done its job, and a Drive outage must not undo
 * it. Every failure here becomes a row and a sentence, never a thrown error.
 *
 * Each artifact is gated on the org's own blueprint. An owner who has not turned these on
 * gets nothing created, silently — that is the blueprint working, not a failure worth
 * reporting as one.
 */
export async function generateArtifactsForConversation(
  db: SupabaseClient, args: ArtifactRunArgs,
  // Injectable so this can be tested without a Google account. Production passes nothing
  // and the clients are built from whatever the org has granted.
  capabilities?: ArtifactCapabilities,
): Promise<ArtifactRunResult> {
  const result: ArtifactRunResult = { documentUrl: null, eventUrl: null, blocked: [] };

  const wantsDocument = canExecute("draft_client_document", false, args.contract).ok;
  const wantsEvent = canExecute("create_calendar_event", false, args.contract).ok;
  if (!wantsDocument && !wantsEvent) return result;

  const { deps, driveReady, calendarReady } =
    capabilities ?? await artifactCapabilitiesFor(db, args.orgId);

  const values = buildTokenValues({
    clientName: args.clientName,
    conversationTitle: args.title,
    occurredAt: args.occurredAt,
    commitments: args.commitments,
    amounts: args.amounts,
    today: new Date().toISOString().slice(0, 10),
  });

  // Recorded, not skipped, when the connection is missing. The blueprint asked for a
  // document and none exists — an owner looking for it needs that sentence, and the table
  // exists to hold exactly this answer.
  if (wantsDocument && !driveReady) {
    const detail = "Google Drive is not connected, so no document was created. "
      + "Connect it in Settings.";
    result.blocked.push(detail);
    await record(args, "document", "missing_tokens", { detail });
  }

  if (wantsDocument && driveReady) {
    try {
      const doc = await generateDocument(db, args.orgId, {
        role: "proposal",
        title: `${args.title} — ${args.clientName}`,
        values,
      }, deps);

      if (doc.ok) {
        result.documentUrl = doc.document.url;
        await record(args, "document", "created", {
          externalId: doc.document.id, url: doc.document.url, title: doc.document.name,
        });
      } else {
        result.blocked.push(doc.detail);
        await record(args, "document", doc.reason, { detail: doc.detail });
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      result.blocked.push(`The document could not be created: ${detail}`);
      await record(args, "document", "failed", { detail });
    }
  }

  if (wantsEvent && !calendarReady) {
    const detail = "Google Calendar is not connected, so no event was created. "
      + "Connect it in Settings.";
    result.blocked.push(detail);
    await record(args, "calendar_event", "missing_tokens", { detail });
  }

  if (wantsEvent && calendarReady) {
    try {
      // The event goes on the date of the soonest promise that carried one, and otherwise on
      // the day of the conversation. Times are UTC because `organization.timezone` defaults
      // to UTC — an org that sets a real timezone will want this revisited, and the same
      // caveat already applies to calendar context reads.
      const day = String(values.next_deadline ?? args.occurredAt).slice(0, 10);
      const start = `${day}T${String(EVENT_HOUR_UTC).padStart(2, "0")}:00:00Z`;
      const end = new Date(Date.parse(start) + EVENT_MINUTES * 60_000).toISOString();

      const event = await generateCalendarEvent(db, args.orgId, {
        values, start, end, fallbackTitle: `Follow up with ${args.clientName}`,
      }, deps);

      if (event.ok) {
        result.eventUrl = event.event.url;
        await record(args, "calendar_event", "created", {
          externalId: event.event.id, url: event.event.url,
        });
      } else {
        result.blocked.push(event.detail);
        await record(args, "calendar_event", event.reason, { detail: event.detail });
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      result.blocked.push(`The calendar event could not be created: ${detail}`);
      await record(args, "calendar_event", "failed", { detail });
    }
  }

  return result;
}

async function record(
  args: ArtifactRunArgs,
  kind: "document" | "calendar_event",
  outcome: "created" | "no_template" | "missing_tokens" | "failed",
  extra: { externalId?: string; url?: string; title?: string; detail?: string },
): Promise<void> {
  // Written with the service client, not the caller's. `generated_artifact` grants insert
  // to service_role alone — these rows are the record that the agent, not a person, created
  // something in Google, and a browser able to write them could claim a document ConductFlow
  // never made. The ingest path runs as the signed-in owner, so passing its client through
  // here meant every insert was refused by RLS and swallowed by the log line below.
  // Same shape as logAudit, for the same reason.
  const { error } = await getServiceClient().from("generated_artifact").insert({
    org_id: args.orgId,
    conversation_id: args.conversationId,
    kind,
    external_id: extra.externalId ?? null,
    url: extra.url ?? null,
    title: extra.title ?? null,
    outcome,
    detail: extra.detail ?? null,
  });
  if (error) console.error("generated_artifact insert failed", error);
}
