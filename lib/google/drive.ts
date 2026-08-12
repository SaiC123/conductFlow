const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const LIST_PAGE_SIZE = 50;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

/**
 * Read-only by construction. There is no method here that creates, updates, or deletes,
 * and adding one would exceed the `drive.file` scope this client is built for.
 */
export interface DriveClient {
  listFiles(query?: string): Promise<DriveFile[]>;
  readFile(file: DriveFile): Promise<string>;
}

export function createDriveClient(accessToken: string): DriveClient {
  const headers = { Authorization: `Bearer ${accessToken}` };

  return {
    /**
     * Under `drive.file` an unfiltered list returns only the files the owner picked through
     * the Google Picker, so no query is needed to stay out of the rest of their Drive.
     */
    async listFiles(query?: string): Promise<DriveFile[]> {
      const params = new URLSearchParams({
        fields: "files(id,name,mimeType,modifiedTime)",
        orderBy: "modifiedTime desc",
        pageSize: String(LIST_PAGE_SIZE),
      });
      if (query) params.set("q", query);

      const response = await fetch(`${DRIVE_FILES}?${params}`, { headers });
      if (!response.ok) throw new Error(`Drive files.list failed: ${response.status}`);

      const body = (await response.json()) as { files?: Partial<DriveFile>[] };
      return (body.files ?? []).map((f) => ({
        id: String(f.id ?? ""),
        name: String(f.name ?? ""),
        mimeType: String(f.mimeType ?? ""),
        modifiedTime: String(f.modifiedTime ?? ""),
      }));
    },

    async readFile(file: DriveFile): Promise<string> {
      // A Google Doc has no bytes to download — it must be exported. Anything uploaded
      // (.txt, .md) is fetched directly.
      const url = file.mimeType === GOOGLE_DOC_MIME
        ? `${DRIVE_FILES}/${file.id}/export?mimeType=text%2Fplain`
        : `${DRIVE_FILES}/${file.id}?alt=media`;

      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`Drive read failed for "${file.name}": ${response.status}`);
      return response.text();
    },
  };
}
