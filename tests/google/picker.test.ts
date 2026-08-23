import { describe, it, expect } from "vitest";
import {
  MAX_PICKED_FILES, TEMPLATE_MIME_TYPES,
  mapPickedDocuments, parsePickedFiles, isSelectableAsTemplate,
} from "@/lib/google/picker";

const doc = {
  id: "1AbC", name: "Follow-up template", mimeType: "application/vnd.google-apps.document",
  url: "https://docs.google.com/document/d/1AbC", sizeBytes: 4096, iconUrl: "https://…",
};

describe("mapPickedDocuments", () => {
  it("keeps only the three fields worth storing", () => {
    expect(mapPickedDocuments([doc])).toEqual([{
      fileId: "1AbC", name: "Follow-up template",
      mimeType: "application/vnd.google-apps.document",
    }]);
  });

  it("drops documents with no id rather than failing the whole pick", () => {
    expect(mapPickedDocuments([{ name: "Nameless" }, doc])).toHaveLength(1);
  });

  it("ignores anything that is not an object", () => {
    expect(mapPickedDocuments(["1AbC", null, 7, doc])).toHaveLength(1);
  });

  it("keeps the first of a repeated file id", () => {
    const files = mapPickedDocuments([doc, { ...doc, name: "Renamed" }]);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("Follow-up template");
  });

  it("trims surrounding whitespace off Drive's strings", () => {
    const [file] = mapPickedDocuments([{ id: "  1AbC ", name: " Template ", mimeType: " text/plain " }]);
    expect(file).toEqual({ fileId: "1AbC", name: "Template", mimeType: "text/plain" });
  });

  it("substitutes a placeholder rather than storing an empty name or type", () => {
    const [file] = mapPickedDocuments([{ id: "1AbC" }]);
    expect(file.name).toBe("Untitled file");
    expect(file.mimeType).toBe("application/octet-stream");
  });

  it("caps a single session at the documented maximum", () => {
    const many = Array.from({ length: MAX_PICKED_FILES + 5 },
      (_, i) => ({ ...doc, id: `file-${i}` }));
    expect(mapPickedDocuments(many)).toHaveLength(MAX_PICKED_FILES);
  });
});

describe("parsePickedFiles", () => {
  const file = { fileId: "1AbC", name: "Follow-up template", mimeType: "text/plain" };

  it("accepts a well-formed list", () => {
    expect(parsePickedFiles([file])).toEqual({ ok: true, files: [file] });
  });

  it("rejects anything that is not an array", () => {
    expect(parsePickedFiles(file).ok).toBe(false);
    expect(parsePickedFiles("1AbC").ok).toBe(false);
    expect(parsePickedFiles(null).ok).toBe(false);
    expect(parsePickedFiles(undefined).ok).toBe(false);
  });

  it("rejects an empty list", () => {
    const result = parsePickedFiles([]);
    expect(result).toEqual({ ok: false, error: "No files were picked." });
  });

  it("rejects more files than one session may hand over", () => {
    const many = Array.from({ length: MAX_PICKED_FILES + 1 },
      (_, i) => ({ ...file, fileId: `file-${i}` }));
    const result = parsePickedFiles(many);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(MAX_PICKED_FILES));
  });

  it("rejects an entry that is not an object", () => {
    expect(parsePickedFiles([file, "1AbC"]).ok).toBe(false);
  });

  it("names the field a malformed entry is missing", () => {
    expect(parsePickedFiles([{ name: "x", mimeType: "text/plain" }])).toEqual({
      ok: false, error: "A picked file is missing its Drive id." });

    const noName = parsePickedFiles([{ fileId: "1AbC", mimeType: "text/plain" }]);
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.error).toContain("name");

    const noType = parsePickedFiles([{ fileId: "1AbC", name: "x" }]);
    expect(noType.ok).toBe(false);
    if (!noType.ok) expect(noType.error).toContain("type");
  });

  it("treats a blank string as missing", () => {
    expect(parsePickedFiles([{ ...file, fileId: "   " }]).ok).toBe(false);
  });

  // A single upsert cannot touch the same (org_id, file_id) twice: Postgres rejects the
  // whole statement. Collapsing the repeat here is what keeps a double-click harmless.
  it("collapses a repeated file id instead of failing the save", () => {
    const result = parsePickedFiles([file, { ...file, name: "Renamed" }]);
    expect(result).toEqual({ ok: true, files: [file] });
  });

  it("truncates a name too long for the column", () => {
    const result = parsePickedFiles([{ ...file, name: "T".repeat(400) }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.files[0].name).toHaveLength(255);
  });
});

describe("isSelectableAsTemplate", () => {
  // Mirrors the /template/i candidate filter in lib/google/context.ts. If that rule ever
  // changes, this test is the thing that notices the copy here has drifted.
  it("matches the names loadTemplate would consider", () => {
    expect(isSelectableAsTemplate("Follow-up template")).toBe(true);
    expect(isSelectableAsTemplate("TEMPLATE — Northwind")).toBe(true);
    expect(isSelectableAsTemplate("Templates for onboarding")).toBe(true);
  });

  it("rejects the names it would never reach for", () => {
    expect(isSelectableAsTemplate("Onboarding checklist")).toBe(false);
    expect(isSelectableAsTemplate("")).toBe(false);
  });
});

describe("TEMPLATE_MIME_TYPES", () => {
  // Every type offered in the picker has to be one lib/google/drive.ts can turn into text,
  // or the owner hands over a file the drafting path silently cannot read.
  it("offers only types the Drive client can read", () => {
    expect([...TEMPLATE_MIME_TYPES]).toEqual([
      "application/vnd.google-apps.document", "text/plain", "text/markdown",
    ]);
  });
});
