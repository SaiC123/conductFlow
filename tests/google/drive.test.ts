import { describe, it, expect, vi, afterEach } from "vitest";
import { createDriveClient, type DriveFile } from "@/lib/google/drive";

const TOKEN = "ya29.fake-access-token";

type FetchInit = { headers: Record<string, string> };

function fakeFetch(response: { ok?: boolean; status?: number; json?: unknown; text?: string }) {
  const fn = vi.fn(async (_url: string, _init?: FetchInit) => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.json ?? {},
    text: async () => response.text ?? "",
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function calledUrl(fn: ReturnType<typeof fakeFetch>, call = 0): string {
  return String(fn.mock.calls[call][0]);
}

function calledAuth(fn: ReturnType<typeof fakeFetch>, call = 0): string | undefined {
  return fn.mock.calls[call][1]?.headers.Authorization;
}

const doc: DriveFile = {
  id: "file-1", name: "Follow-up template", modifiedTime: "2026-08-10T09:00:00Z",
  mimeType: "application/vnd.google-apps.document",
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("createDriveClient", () => {
  it("exposes only read methods", () => {
    const client = createDriveClient(TOKEN);
    expect(Object.keys(client).sort()).toEqual(["listFiles", "readFile"]);
  });

  it("lists files newest first and sends the bearer token", async () => {
    const fetchMock = fakeFetch({ json: { files: [
      { id: "a", name: "Follow-up template", mimeType: "text/plain", modifiedTime: "2026-08-10T09:00:00Z" },
    ] } });

    const files = await createDriveClient(TOKEN).listFiles();

    expect(files).toEqual([{
      id: "a", name: "Follow-up template", mimeType: "text/plain",
      modifiedTime: "2026-08-10T09:00:00Z",
    }]);
    expect(calledUrl(fetchMock)).toContain("orderBy=modifiedTime+desc");
    expect(calledAuth(fetchMock)).toBe(`Bearer ${TOKEN}`);
  });

  it("omits the query parameter when no query is given", async () => {
    const fetchMock = fakeFetch({ json: { files: [] } });
    await createDriveClient(TOKEN).listFiles();
    expect(calledUrl(fetchMock)).not.toContain("q=");
  });

  it("passes a query through when one is given", async () => {
    const fetchMock = fakeFetch({ json: { files: [] } });
    await createDriveClient(TOKEN).listFiles("name contains 'template'");
    expect(calledUrl(fetchMock)).toContain("q=name+contains");
  });

  it("returns an empty list when the response carries no files", async () => {
    fakeFetch({ json: {} });
    expect(await createDriveClient(TOKEN).listFiles()).toEqual([]);
  });

  it("exports a Google Doc as plain text", async () => {
    const fetchMock = fakeFetch({ text: "Dear client," });
    const body = await createDriveClient(TOKEN).readFile(doc);

    expect(body).toBe("Dear client,");
    expect(calledUrl(fetchMock)).toContain("/files/file-1/export?mimeType=text%2Fplain");
  });

  it("downloads an uploaded file directly", async () => {
    const fetchMock = fakeFetch({ text: "# Template" });
    await createDriveClient(TOKEN).readFile({ ...doc, mimeType: "text/markdown" });
    expect(calledUrl(fetchMock)).toContain("/files/file-1?alt=media");
  });

  it("throws with the status when listing fails", async () => {
    fakeFetch({ ok: false, status: 403 });
    await expect(createDriveClient(TOKEN).listFiles()).rejects.toThrow(/403/);
  });

  it("names the file when a read fails", async () => {
    fakeFetch({ ok: false, status: 404 });
    await expect(createDriveClient(TOKEN).readFile(doc)).rejects.toThrow(/Follow-up template.*404/);
  });
});
