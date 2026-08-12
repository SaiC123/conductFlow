const EVENTS_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const LIST_PAGE_SIZE = 25;

export interface CalendarEvent {
  id: string;
  title: string | null;
  start: string;
  attendeeCount: number;
}

export interface DayRange {
  timeMin: string;
  timeMax: string;
}

/** Read-only: `events.list` and nothing else, matching the `calendar.events.readonly` scope. */
export interface CalendarClient {
  listEvents(range: DayRange): Promise<CalendarEvent[]>;
}

interface RawEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: unknown[];
}

export function createCalendarClient(accessToken: string): CalendarClient {
  const headers = { Authorization: `Bearer ${accessToken}` };

  return {
    async listEvents(range: DayRange): Promise<CalendarEvent[]> {
      const params = new URLSearchParams({
        timeMin: range.timeMin,
        timeMax: range.timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(LIST_PAGE_SIZE),
      });

      const response = await fetch(`${EVENTS_API}?${params}`, { headers });
      if (!response.ok) throw new Error(`Calendar events.list failed: ${response.status}`);

      const body = (await response.json()) as { items?: RawEvent[] };

      // Attendees collapse to a count here, at the boundary, so no attendee email ever
      // enters the application. A draft needs to know a meeting had six people in it;
      // it has no use for who they were.
      return (body.items ?? []).map((e) => ({
        id: String(e.id ?? ""),
        title: e.summary ?? null,
        start: e.start?.dateTime ?? e.start?.date ?? "",
        attendeeCount: Array.isArray(e.attendees) ? e.attendees.length : 0,
      }));
    },
  };
}
