import { MAX_TRANSCRIPT_CHARS } from "@/lib/agent/schema";

const SUPPORTED = [".txt", ".md", ".vtt"] as const;

/**
 * Converts an uploaded transcript file to plain text.
 * Pure: takes the decoded text, returns text. No I/O, no storage.
 */
export function parseTranscriptFile(filename: string, text: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!SUPPORTED.includes(ext as (typeof SUPPORTED)[number])) {
    throw new Error(`Unsupported file type "${ext}". Upload a .txt, .md, or .vtt file.`);
  }
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(`Transcript is too long: ${text.length} characters (max ${MAX_TRANSCRIPT_CHARS}).`);
  }

  const out = ext === ".vtt" ? parseVtt(text) : text;
  if (out.trim().length === 0) throw new Error("That file is empty.");
  return out;
}

/**
 * Strips WEBVTT structure while KEEPING speaker labels — `<v Tutor>text</v>` becomes
 * `Tutor: text`. Attribution is what lets extraction fill the commitment owner, so
 * dropping speaker tags would discard the signal the whole feature depends on.
 */
function parseVtt(text: string): string {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => {
          const t = line.trim();
          if (t === "" || t === "WEBVTT") return false;
          if (t.includes("-->")) return false;
          if (/^\d+$/.test(t)) return false;
          if (/^(NOTE|STYLE|REGION)\b/.test(t)) return false;
          return true;
        })
        .join(" ")
        .trim(),
    )
    .filter((block) => block.length > 0)
    .map((block) =>
      block
        .replace(/<v\s+([^>]+)>/, "$1: ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join("\n");
}
