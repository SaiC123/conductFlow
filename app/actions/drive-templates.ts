"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { logAudit } from "@/lib/audit/log";
import { getAccessToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { createDriveClient, LIST_PAGE_SIZE } from "@/lib/google/drive";
import { createDocsWriteClient, GOOGLE_DOC_MIME } from "@/lib/google/docs";
import { DRIVE_FILE_SCOPE, parsePickedFiles, type PickedFile } from "@/lib/google/picker";
import { isTemplateRole, boundRoles } from "@/lib/google/templates";
import { STARTER_TEMPLATES } from "@/lib/google/starter-templates";
import { reportable, type ActionFailed } from "@/lib/actions/result";

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
export async function recordPickedTemplates(
  payload: unknown,
): Promise<RecordedPick | ActionFailed> {
  return reportable("recordPickedTemplates", () => record(payload));
}

async function record(payload: unknown): Promise<RecordedPick> {
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

export interface CreatedStarter {
  role: string;
  name: string;
  /** Where the owner opens it to edit the wording. */
  url: string;
}

export interface StarterResult {
  created: CreatedStarter[];
  /** Roles left alone because the org had already bound something to them. */
  alreadyBound: string[];
}

/**
 * Writes ConductFlow's own starter templates into the org's Drive and binds them.
 *
 * The Picker is the other way to get a template bound, and it depends on three things
 * lining up in a Google Cloud Console — an OAuth client carrying the page's origin, a
 * browser API key from the same project, and the Picker API enabled on it. When any of them
 * is wrong the browser gets a bare `401 invalid_client` naming none of them, and an owner
 * has no way forward from inside the product. This path needs none of it: the server
 * already holds a `drive.file` token, and `drive.file` covers a file the app itself created.
 *
 * Deliberately additive. A role an org has already bound is left exactly as it is, so this
 * can be pressed twice without quietly replacing somebody's own template.
 */
export async function createStarterTemplates(): Promise<StarterResult | ActionFailed> {
  // "Connect Google Drive first — ConductFlow needs somewhere to put the templates" is a
  // repair instruction, and it was the single most useful sentence in this file being
  // replaced by a digest.
  return reportable("createStarterTemplates", writeStarters);
}

async function writeStarters(): Promise<StarterResult> {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to create starter templates.");

  const db = await getServerClient();
  const { data: auth } = await db.auth.getUser();
  const userId = auth.user?.id ?? null;

  const bound = await boundRoles(db, orgId);
  const todo = STARTER_TEMPLATES.filter((t) => !bound[t.role]);
  const alreadyBound = STARTER_TEMPLATES
    .filter((t) => bound[t.role]).map((t) => t.role);
  if (todo.length === 0) return { created: [], alreadyBound };

  // The service client, because this is the same refresh-token-derived Drive access the
  // ingest path uses. The rows below are still written as the signed-in user, so
  // drive_template's RLS stays in the path for the part that touches the database.
  let docs;
  try {
    docs = createDocsWriteClient(
      await getAccessToken(getServiceClient(), orgId, DRIVE_FILE_SCOPE));
  } catch (e) {
    if (e instanceof DataSourceUnavailable) {
      throw new Error("Connect Google Drive first — ConductFlow needs somewhere to put the"
        + " templates. Use the Drive capability above.");
    }
    throw e;
  }

  const now = new Date().toISOString();
  const created: CreatedStarter[] = [];

  // Sequential on purpose. Two creates and two inserts is not worth a partial-failure story
  // where one document exists in Drive with no row pointing at it.
  for (const starter of todo) {
    const document = await docs.createTextDocument(starter.name, starter.body);

    const { error } = await db.from("drive_template").upsert({
      org_id: orgId,
      file_id: document.id,
      name: document.name,
      mime_type: GOOGLE_DOC_MIME,
      picked_by: userId,
      role: starter.role,
      state: "active",
      updated_at: now,
    }, { onConflict: "org_id,file_id" });
    if (error) throw error;

    created.push({ role: starter.role, name: document.name, url: document.url });
  }

  await logAudit({
    orgId, actor: "human", action: "create",
    target: `drive_template:starter:${created.map((c) => c.role).join(",")}`,
    payloadHash: userId ?? undefined,
  });

  revalidatePath("/settings");
  return { created, alreadyBound };
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
  return reportable("setTemplateRole", () => bindRole(templateId, role));
}

async function bindRole(templateId: string, role: string | null) {
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
  return reportable("forgetDriveTemplate", () => forget(templateId));
}

async function forget(templateId: string) {
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
