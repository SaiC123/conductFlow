const EVENTS_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export interface NewEvent {
  title: string;
  /** RFC3339, with offset. The caller resolves the org's timezone; this client does not. */
  start: string;
  end: string;
  description?: string;
}

export interface CreatedEvent {
  id: string;
  /** Google's own link to the event in the owner's calendar. */
  url: string;
}

/**
 * Event creation, kept out of `lib/google/calendar.ts` for the same reason document writes
 * are kept out of `lib/google/drive.ts`: that client is documented as read-only and matches
 * the `calendar.events.readonly` scope every context path holds. This one needs the wider
 * `calendar.events` scope, and a caller should have to reach for it deliberately.
 */
export interface CalendarWriteClient {
  createEvent(event: NewEvent): Promise<CreatedEvent>;
}

export function createCalendarWriteClient(accessToken: string): CalendarWriteClient {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  return {
    async createEvent(event: NewEvent): Promise<CreatedEvent> {
      // No `attendees`, and this is the load-bearing part of the whole file.
      //
      // A Google Doc and a Gmail draft are inert until a human sends them. A calendar event
      // is not: the moment it is created with attendees, Google emails every one of them.
      // ConductFlow creates artifacts without staging them for review, so an event carrying
      // the client's address would reach that client with nobody having read it first —
      // which is the one thing HARD_PROHIBITED's `send_external_email` exists to prevent,
      // arrived at through a different door.
      //
      // The event lands on the owner's own calendar. Adding the client stays a deliberate
      // click in Google's UI, by a human who has seen what the event says.
      //
      // sendUpdates=none is belt and braces: with no attendees there is nobody to notify,
      // but it also means a future edit to this call cannot start mailing people by default.
      const params = new URLSearchParams({ sendUpdates: "none" });

      const response = await fetch(`${EVENTS_API}?${params}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          summary: event.title,
          description: event.description,
          start: { dateTime: event.start },
          end: { dateTime: event.end },
        }),
      });
      if (!response.ok) {
        throw new Error(`Calendar events.insert failed: ${response.status}`);
      }

      const body = (await response.json()) as { id?: string; htmlLink?: string };
      const id = String(body.id ?? "");
      if (!id) throw new Error("Calendar events.insert returned no event id.");

      return { id, url: body.htmlLink ?? `https://calendar.google.com/calendar/r/eventedit/${id}` };
    },
  };
}
