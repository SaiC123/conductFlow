import { sanitizeIngested, wrapAsData } from "@/lib/agent/injection";
import type { CalendarClient, CalendarEvent } from "./calendar";
import type { DriveClient, DriveFile } from "./drive";

export const MAX_TEMPLATE_CHARS = 20_000;
export const MAX_EVENTS = 3;

export interface DraftContext {
  templateText: string | null;
  meetingContext: string | null;
  sources: string[];
}

export interface DraftContextInput {
  drive: DriveClient;
  calendar: CalendarClient;
  clientName: string;
  /** Conversation date, YYYY-MM-DD. */
  occurredAt: string;
}

/**
 * Gathers the company's own writing and the meeting around a conversation, so a follow-up
 * sounds like the business rather than like a model. Every failure degrades to null:
 * missing context should produce a plainer draft, never a failed one.
 */
export async function buildDraftContext(input: DraftContextInput): Promise<DraftContext> {
  const sources: string[] = [];
  const templateText = await loadTemplate(input.drive, input.clientName, sources);
  const meetingContext = await loadMeetingContext(input.calendar, input.occurredAt, sources);
  return { templateText, meetingContext, sources };
}

async function loadTemplate(
  drive: DriveClient, clientName: string, sources: string[],
): Promise<string | null> {
  let file: DriveFile | null = null;
  let raw = "";
  try {
    file = pickTemplate(await drive.listFiles(), clientName);
    if (!file) return null;
    raw = await drive.readFile(file);
  } catch {
    // An unreadable template is a missing template. The draft still gets written.
    return null;
  }

  const trimmed = truncateOnParagraph(raw).trim();
  if (trimmed.length === 0) return null;

  const { text, flagged } = sanitizeIngested(trimmed);
  recordFlags(sources, flagged);
  // `template` is the source name the agent contract already allows, so it is recorded
  // verbatim — a decorated string would fail a naive allowedSources check.
  sources.push("template");
  return wrapAsData(text);
}

async function loadMeetingContext(
  calendar: CalendarClient, occurredAt: string, sources: string[],
): Promise<string | null> {
  let events: CalendarEvent[] = [];
  try {
    events = await calendar.listEvents(dayRange(occurredAt));
  } catch {
    return null;
  }

  const summary = summarizeEvents(events);
  if (!summary) return null;

  const { text, flagged } = sanitizeIngested(summary);
  recordFlags(sources, flagged);
  sources.push("calendar_event");
  return wrapAsData(text);
}

/**
 * Selection rule: a template naming the client beats a generic one, and within each group
 * the most recently modified wins. An owner keeping "Follow-up template" alongside
 * "Follow-up template — Northwind" gets the Northwind one when drafting for Northwind and
 * the generic one for every other client.
 */
function pickTemplate(files: DriveFile[], clientName: string): DriveFile | null {
  const candidates = files.filter((f) => /template/i.test(f.name));
  if (candidates.length === 0) return null;

  const key = clientKey(clientName);
  const named = key ? candidates.filter((f) => normalize(f.name).includes(key)) : [];
  const pool = named.length > 0 ? named : candidates;

  return pool.reduce((newest, f) => (f.modifiedTime > newest.modifiedTime ? f : newest));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The client's identifying word — the first token of three characters or more. "Ramirez
 * family (tutoring)" identifies as "ramirez"; matching on the whole string would miss
 * "Template — Ramirez", and matching on any token would let "tutoring" claim every
 * tutoring client's template.
 */
function clientKey(clientName: string): string | null {
  const tokens = normalize(clientName).split(" ").filter(Boolean);
  return tokens.find((t) => t.length >= 3) ?? null;
}

function truncateOnParagraph(text: string): string {
  if (text.length <= MAX_TEMPLATE_CHARS) return text;
  const window = text.slice(0, MAX_TEMPLATE_CHARS);
  const lastBreak = window.lastIndexOf("\n\n");
  return lastBreak > 0 ? window.slice(0, lastBreak) : window;
}

function summarizeEvents(events: CalendarEvent[]): string | null {
  const lines = events.slice(0, MAX_EVENTS).map((e) => {
    const title = e.title?.trim() || "Untitled event";
    const parsed = new Date(e.start);
    const clock = Number.isNaN(parsed.getTime()) ? "time unknown" : parsed.toISOString().slice(11, 16);
    const attendees = e.attendeeCount === 1 ? "1 attendee" : `${e.attendeeCount} attendees`;
    return `- ${title} at ${clock} (${attendees})`;
  });
  return lines.length > 0 ? lines.join("\n") : null;
}

function recordFlags(sources: string[], flagged: string[]) {
  for (const pattern of flagged) {
    const entry = `flagged:${pattern}`;
    if (!sources.includes(entry)) sources.push(entry);
  }
}

/** Events overlapping the conversation date, in UTC. */
function dayRange(occurredAt: string): { timeMin: string; timeMax: string } {
  const [y, m, d] = occurredAt.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}
