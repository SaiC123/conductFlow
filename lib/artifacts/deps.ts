import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "@/lib/google/tokens";
import { createDriveClient } from "@/lib/google/drive";
import { createDocsWriteClient } from "@/lib/google/docs";
import { createCalendarWriteClient } from "@/lib/google/calendar-write";
import { CAPABILITIES } from "@/lib/google/scopes";
import type { ArtifactDeps } from "./generate";

export interface ArtifactCapabilities {
  deps: ArtifactDeps;
  /** The org granted `drive.file`, so templates can be read and documents created. */
  driveReady: boolean;
  /** The org granted `calendar.events`, so events can be created. */
  calendarReady: boolean;
}

/**
 * Builds the Google clients the generators need from whatever the org has actually granted.
 *
 * Never throws. An org that connected nothing is the normal case until someone visits
 * Settings, and an ingest must not fail because of it — the caller checks `driveReady` and
 * `calendarReady` and skips what it cannot do.
 *
 * Note document creation rides on `drive_templates` rather than a capability of its own:
 * `drive.file` covers reading a picked template, copying it, and writing a new file from
 * scratch, and all three are app-created so the Docs API accepts the same token. That last
 * one is what lets an org with no bound template still get a document — see `sourceFor` in
 * ./generate.ts.
 */
export async function artifactCapabilitiesFor(
  service: SupabaseClient, orgId: string,
): Promise<ArtifactCapabilities> {
  const [driveToken, calendarToken] = await Promise.all([
    tokenOrNull(service, orgId, CAPABILITIES.drive_templates.scopes[0]),
    tokenOrNull(service, orgId, CAPABILITIES.calendar_events.scopes[0]),
  ]);

  const drive = createDriveClient(driveToken ?? "");
  const docs = createDocsWriteClient(driveToken ?? "");

  return {
    driveReady: driveToken !== null,
    calendarReady: calendarToken !== null,
    deps: {
      readTemplate: (template) => drive.readFile({
        id: template.fileId,
        name: template.name,
        mimeType: template.mimeType,
        // readFile only branches on mimeType; modifiedTime is not consulted.
        modifiedTime: "",
      }),
      docs,
      // Same client, named separately so the generation path has to ask for the ability to
      // write a *new* file rather than getting it as a side effect of being able to copy one.
      docsCreate: docs,
      calendar: createCalendarWriteClient(calendarToken ?? ""),
    },
  };
}

async function tokenOrNull(
  service: SupabaseClient, orgId: string, scope: string,
): Promise<string | null> {
  try {
    return await getAccessToken(service, orgId, scope);
  } catch {
    return null;
  }
}
