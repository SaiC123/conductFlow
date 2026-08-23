"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { logAudit } from "@/lib/audit/log";
import { getAccessToken } from "@/lib/google/tokens";
import { createDriveClient, LIST_PAGE_SIZE } from "@/lib/google/drive";
import { DRIVE_FILE_SCOPE, parsePickedFiles, type PickedFile } from "@/lib/google/picker";
import { isTemplateRole } from "@/lib/google/templates";

export interface RecordedPick {
  recorded: number;
  /** True when the server was able to check the files against its own Drive token. */
  verified: boolean;
  /** Names the server's own token cannot see. Empty unless `verified`. */
  unreadable: string[];
}

/**
 * Writes down what the owner just handed over in the browser.
 *
 * The pick itself happens client-side against Google Identity Services, because the Picker
 * needs an access token in the page and the server's refresh-token-derived one is never
 * going there. That works because a `drive.file` grant attaches to the OAuth *client id*
 * plus the Google account — not to the individual token — so a file picked in the browser
 * becomes readable by the server's own token for the same client id and account. This
 * action records the result; it is not what creates the access.
 */
export async function recordPickedTemplates(payload: unknown): Promise<RecordedPick> {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to hand over a template file.");

  // A server action argument is attacker input however friendly the component that normally
  // sends it, so the shape is decided here rather than trusted from the browser.
  const parsed = parsePickedFiles(payload);
  if (!parsed.ok) throw new Error(parsed.error);

  const db = await getServerClient();
  const { data: auth } = await db.auth.getUser();
  const userId = auth.user?.id ?? null;
  const now = new Date().toISOString();

  // Written as the signed-in user rather than as service_role: drive_template's RLS
  // policies are then in the path, and a file cannot be attached to somebody else's org
  // even if this function's org lookup were wrong.
  const { error } = await db.from("drive_template").upsert(
    parsed.files.map((file) => ({
      org_id: orgId,
      file_id: file.fileId,
      name: file.name,
      mime_type: file.mimeType,
      picked_by: userId,
      // Re-picking a file the org had removed brings the same row back.
      state: "active",
      updated_at: now,
    })),
    { onConflict: "org_id,file_id" },
  );
  if (error) throw error;

  await logAudit({
    orgId, actor: "human", action: "create",
    target: `drive_template:pick:${parsed.files.length}`,
    payloadHash: userId ?? undefined,
  });

  const unreadable = await findUnreadable(orgId, parsed.files);
  revalidatePath("/settings");
  return {
    recorded: parsed.files.length,
    verified: unreadable !== null,
    unreadable: unreadable ?? [],
  };
}

/**
 * Binds a picked file to the artifact it feeds, or clears that binding when `role` is null.
 *
 * This is what turns `drive_template` from the record migration 0012 described into the
 * authority the artifact generators read. The recap path in lib/google/context.ts is
 * unaffected and still chooses by filename.
 *
 * A role is exclusive per org, enforced by the partial unique index in 0019. Rather than
 * letting that surface as a raw 23505, the previous holder is cleared first, so re-assigning
 * a role reads as moving it rather than as an error an owner has to interpret.
 */
export async function setTemplateRole(templateId: string, role: string | null) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to edit your template files.");
  if (role !== null && !isTemplateRole(role)) throw new Error(`Unknown template role "${role}".`);

  const db = await getServerClient();
  const { data: auth } = await db.auth.getUser();
  const now = new Date().toISOString();

  if (role !== null) {
    const { error: clearError } = await db.from("drive_template")
      .update({ role: null, updated_at: now })
      .eq("org_id", orgId).eq("role", role).eq("state", "active")
      .neq("id", templateId);
    if (clearError) throw clearError;
  }

  const { error } = await db.from("drive_template")
    .update({ role, updated_at: now })
    .eq("id", templateId).eq("org_id", orgId);
  if (error) throw error;

  await logAudit({
    orgId, actor: "human", action: "update",
    target: `drive_template:${templateId}:role:${role ?? "none"}`,
    payloadHash: auth.user?.id,
  });
  revalidatePath("/settings");
}

/**
 * Forgetting a file clears the record; it does not delete it. Which files an org pointed an
 * AI at is audit history — see the note in migration 0012.
 */
export async function forgetDriveTemplate(templateId: string) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to edit your template files.");

  const db = await getServerClient();
  const { data: auth } = await db.auth.getUser();

  const { error } = await db.from("drive_template")
    .update({ state: "removed", updated_at: new Date().toISOString() })
    .eq("id", templateId).eq("org_id", orgId);
  if (error) throw error;

  await logAudit({
    orgId, actor: "human", action: "update",
    target: `drive_template:${templateId}:forget`,
    payloadHash: auth.user?.id,
  });
  revalidatePath("/settings");
}

/**
 * The one failure that would otherwise be invisible: the browser grant landed on a different
 * Google account than the one the server holds a refresh token for. Because `drive.file`
 * access is scoped to the client id *and* the granting account, files picked under the wrong
 * account stay unreadable to the server no matter how correct the row here looks — and
 * nothing in the picker response says which account was used. Listing what the server can
 * actually see is the only honest check available at this point.
 *
 * Returns null when the check could not run, which is not the same as "all fine": no Drive
 * grant yet, a revoked one, or a list long enough that page two might hold the answer.
 */
async function findUnreadable(orgId: string, files: PickedFile[]): Promise<string[] | null> {
  try {
    const token = await getAccessToken(getServiceClient(), orgId, DRIVE_FILE_SCOPE);
    const visible = await createDriveClient(token).listFiles();
    // At the page limit "not shared with us" is indistinguishable from "further down the
    // list", so the check declines to answer rather than accusing an owner of using the
    // wrong Google account.
    if (visible.length >= LIST_PAGE_SIZE) return null;

    const ids = new Set(visible.map((file) => file.id));
    return files.filter((file) => !ids.has(file.fileId)).map((file) => file.name);
  } catch {
    return null;
  }
}
