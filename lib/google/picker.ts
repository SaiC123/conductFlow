/**
 * Everything about a Drive pick that is a pure function of its input, kept out of both the
 * browser component and the server action so the two agree on one set of rules and neither
 * needs a browser or a database to be tested.
 */

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * What lib/google/drive.ts can actually turn into text: a Google Doc it exports, or plain
 * text it downloads. Offering an owner a spreadsheet to pick would be offering them a file
 * the drafting path cannot read.
 */
export const TEMPLATE_MIME_TYPES = [
  "application/vnd.google-apps.document",
  "text/plain",
  "text/markdown",
] as const;

/** One picker session. Generous, but bounded: an unbounded array is an unbounded insert. */
export const MAX_PICKED_FILES = 25;

/** Drive itself caps a file name at 32k, but nothing useful lives past this. */
const MAX_NAME_CHARS = 255;

export interface PickedFile {
  fileId: string;
  name: string;
  mimeType: string;
}

/**
 * The three fields worth keeping out of a picker document. The Picker hands back a much
 * larger object — urls, icons, thumbnails, parent ids — and none of it is ours to store.
 * Anything unusable is dropped rather than rejected: a picker session that half worked
 * should still record the files it did return.
 */
export function mapPickedDocuments(documents: readonly unknown[]): PickedFile[] {
  const seen = new Set<string>();
  const files: PickedFile[] = [];

  for (const document of documents) {
    if (typeof document !== "object" || document === null) continue;
    const doc = document as Record<string, unknown>;

    const fileId = text(doc.id);
    if (!fileId || seen.has(fileId)) continue;
    seen.add(fileId);

    files.push({
      fileId,
      name: text(doc.name).slice(0, MAX_NAME_CHARS) || "Untitled file",
      mimeType: text(doc.mimeType) || "application/octet-stream",
    });
  }

  return files.slice(0, MAX_PICKED_FILES);
}

export type ParsedPick =
  | { ok: true; files: PickedFile[] }
  | { ok: false; error: string };

/**
 * The server's own check on what the browser sent. A server action argument is attacker
 * input however friendly the component that normally sends it, so shape, size, and
 * emptiness are all decided here rather than trusted from the client.
 */
export function parsePickedFiles(payload: unknown): ParsedPick {
  if (!Array.isArray(payload)) return { ok: false, error: "Expected a list of picked files." };
  if (payload.length === 0) return { ok: false, error: "No files were picked." };
  if (payload.length > MAX_PICKED_FILES) {
    return { ok: false, error: `At most ${MAX_PICKED_FILES} files can be handed over at once.` };
  }

  const seen = new Set<string>();
  const files: PickedFile[] = [];

  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: "Every picked file must be an object." };
    }
    const raw = entry as Record<string, unknown>;
    const fileId = text(raw.fileId);
    const name = text(raw.name);
    const mimeType = text(raw.mimeType);

    if (!fileId) return { ok: false, error: "A picked file is missing its Drive id." };
    if (!name) return { ok: false, error: `Picked file ${fileId} is missing its name.` };
    if (!mimeType) return { ok: false, error: `Picked file ${fileId} is missing its type.` };

    // A single upsert may not touch the same (org_id, file_id) twice — Postgres rejects the
    // whole statement with "cannot affect row a second time" — so a repeat is dropped here
    // rather than turned into a save that fails for a reason nobody can act on.
    if (seen.has(fileId)) continue;
    seen.add(fileId);

    files.push({ fileId, name: name.slice(0, MAX_NAME_CHARS), mimeType });
  }

  return { ok: true, files };
}

/**
 * Whether loadTemplate() in lib/google/context.ts would ever consider this file at all. Its
 * candidate filter is /template/i on the name, so handing ConductFlow "Onboarding checklist"
 * grants access to a file the drafting path will never look at. Saying so at pick time beats
 * a silent no-op weeks later. tests/google/picker.test.ts fails if the two copies drift.
 */
export function isSelectableAsTemplate(name: string): boolean {
  return /template/i.test(name);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
