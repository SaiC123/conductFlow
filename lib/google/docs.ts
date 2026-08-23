const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
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

export interface TokenReplacement {
  /**
   * The exact text as it appears in the template — `{{ client_name }}` with its spacing,
   * not the normalised name. `replaceAllText` matches a literal, and lib/artifacts/tokens.ts
   * deliberately accepts inner whitespace, so anything else silently fails to substitute.
   */
  literal: string;
  value: string;
}

export function createDocsWriteClient(accessToken: string): DocsWriteClient {
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
  };
}
