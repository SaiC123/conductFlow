const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const DOCS_DOCUMENTS = "https://docs.googleapis.com/v1/documents";

export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

export interface CreatedDocument {
  id: string;
  name: string;
  /** Where an owner opens it. Google's own canonical edit link. */
  url: string;
}

/**
 * The write half of Drive, kept out of `lib/google/drive.ts` on purpose.
 *
 * That file documents itself as read-only by construction, and it is the client every
 * context-gathering path uses. Putting a create method on it would mean every caller that
 * only ever wanted to read a template now holds a handle that can write to an owner's Drive.
 * A separate client keeps "can create documents" a thing a caller has to ask for.
 *
 * Scope-wise this needs nothing new: `drive.file` already covers copying a file the owner
 * handed over through the Picker, and the copy is app-created, so the Docs API will accept
 * the same token for the substitution pass. No consent screen change, no CASA change.
 */
export interface DocsWriteClient {
  /** Copies a bound template. The copy is app-created, so `drive.file` keeps reaching it. */
  copyTemplate(templateFileId: string, title: string): Promise<CreatedDocument>;
  /** Replaces every token in an already-created document, in one batch. */
  replaceTokens(documentId: string, replacements: TokenReplacement[]): Promise<void>;
}

/**
 * Writing a *new* document from scratch, kept off `DocsWriteClient` for the same reason
 * that one is kept off `DriveClient`: the generation path only ever copies a template an
 * owner already bound, and it should not hold a handle that can put arbitrary new files in
 * someone's Drive. Only the settings action asks for this one.
 *
 * Scope-wise it needs nothing new either. `drive.file` covers a file the app created, so a
 * document uploaded here is readable, copyable and substitutable afterwards by exactly the
 * same token — which is what lets an org bind a template without the Google Picker.
 * See lib/google/starter-templates.ts.
 */
export interface DocsCreateClient {
  createTextDocument(title: string, body: string): Promise<CreatedDocument>;
}

export interface TokenReplacement {
  /**
   * The exact text as it appears in the template — `{{ client_name }}` with its spacing,
   * not the normalised name. `replaceAllText` matches a literal, and lib/artifacts/tokens.ts
   * deliberately accepts inner whitespace, so anything else silently fails to substitute.
   */
  literal: string;
  value: string;
}

export function createDocsWriteClient(
  accessToken: string,
): DocsWriteClient & DocsCreateClient {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  return {
    async copyTemplate(templateFileId: string, title: string): Promise<CreatedDocument> {
      const params = new URLSearchParams({ fields: "id,name,webViewLink" });
      const response = await fetch(`${DRIVE_FILES}/${templateFileId}/copy?${params}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: title }),
      });
      if (!response.ok) {
        throw new Error(`Drive files.copy failed: ${response.status}`);
      }

      const body = (await response.json()) as
        { id?: string; name?: string; webViewLink?: string };
      const id = String(body.id ?? "");
      if (!id) throw new Error("Drive files.copy returned no file id.");

      return {
        id,
        name: String(body.name ?? title),
        // webViewLink is absent from some responses; the canonical form is derivable.
        url: body.webViewLink ?? `https://docs.google.com/document/d/${id}/edit`,
      };
    },

    async replaceTokens(
      documentId: string, replacements: TokenReplacement[],
    ): Promise<void> {
      const requests = replacements.map(({ literal, value }) => ({
        replaceAllText: {
          // matchCase false so a template author writing {{Client_Name}} still gets filled,
          // matching what lib/artifacts/tokens.ts accepts.
          containsText: { text: literal, matchCase: false },
          replaceText: value,
        },
      }));
      if (requests.length === 0) return;

      const response = await fetch(`${DOCS_DOCUMENTS}/${documentId}:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requests }),
      });
      if (!response.ok) {
        throw new Error(`Docs batchUpdate failed: ${response.status}`);
      }
    },

    async createTextDocument(title: string, body: string): Promise<CreatedDocument> {
      // One multipart request rather than create-then-write: an upload whose target mime
      // type is a Google Doc is converted on arrival, so there is no window in which a
      // half-written document exists in someone's Drive.
      const params = new URLSearchParams({
        uploadType: "multipart",
        fields: "id,name,webViewLink",
      });
      const response = await fetch(`${DRIVE_UPLOAD}?${params}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
        },
        body: multipart({ name: title, mimeType: GOOGLE_DOC_MIME }, body),
      });
      if (!response.ok) {
        throw new Error(`Drive files.create failed: ${response.status}`);
      }

      const created = (await response.json()) as
        { id?: string; name?: string; webViewLink?: string };
      const id = String(created.id ?? "");
      if (!id) throw new Error("Drive files.create returned no file id.");

      return {
        id,
        name: String(created.name ?? title),
        url: created.webViewLink ?? `https://docs.google.com/document/d/${id}/edit`,
      };
    },
  };
}

/**
 * Fixed rather than random: nothing here is adversarial input, both parts are written by
 * this file, and a constant keeps the request byte-identical across runs so a failure is
 * reproducible. `text/plain; charset=UTF-8` is what makes Drive convert cleanly — without
 * the charset an em dash arrives mangled.
 */
const MULTIPART_BOUNDARY = "conductflow-drive-upload";

function multipart(metadata: Record<string, string>, body: string): string {
  return [
    `--${MULTIPART_BOUNDARY}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${MULTIPART_BOUNDARY}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
    `--${MULTIPART_BOUNDARY}--`,
    "",
  ].join("\r\n");
}
