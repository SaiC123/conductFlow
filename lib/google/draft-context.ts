import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken, DataSourceUnavailable } from "./tokens";
import { createDriveClient } from "./drive";
import { createCalendarClient } from "./calendar";
import { buildDraftContext, type DraftContext } from "./context";
import { CAPABILITIES } from "./scopes";

const EMPTY: DraftContext = { templateText: null, meetingContext: null, sources: [] };

/**
 * Fetches Drive/Calendar context for an org that has connected them, and returns empty
 * context for an org that has not — which is every org until someone visits Settings.
 *
 * Never throws. A drafting run must not fail because Google is unreachable; it just
 * produces a plainer draft.
 */
export async function contextForOrg(
  service: SupabaseClient,
  args: { orgId: string; clientName: string; occurredAt: string },
): Promise<DraftContext> {
  const [driveToken, calendarToken] = await Promise.all([
    tokenOrNull(service, args.orgId, CAPABILITIES.drive_templates.scopes[0]),
    tokenOrNull(service, args.orgId, CAPABILITIES.calendar_context.scopes[0]),
  ]);
  if (!driveToken && !calendarToken) return EMPTY;

  try {
    return await buildDraftContext({
      // A capability the org did not grant yields a client whose calls fail, and
      // buildDraftContext already degrades each source to null on failure.
      drive: createDriveClient(driveToken ?? ""),
      calendar: createCalendarClient(calendarToken ?? ""),
      clientName: args.clientName,
      occurredAt: args.occurredAt,
    });
  } catch {
    return EMPTY;
  }
}

async function tokenOrNull(
  service: SupabaseClient, orgId: string, scope: string,
): Promise<string | null> {
  try {
    return await getAccessToken(service, orgId, scope);
  } catch (e) {
    // Every failure means the same thing here: no usable token, so no context. That
    // includes an unconfigured DATA_SOURCE_KEK — a deployment without the key loses
    // Google features and keeps drafting, which is exactly what §6 of the 3A spec asks for.
    if (e instanceof DataSourceUnavailable) return null;
    return null;
  }
}
