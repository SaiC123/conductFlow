import { describe, it, expect, vi, afterEach } from "vitest";
import { createCalendarClient } from "@/lib/google/calendar";

const TOKEN = "ya29.fake-access-token";
const RANGE = { timeMin: "2026-08-11T00:00:00.000Z", timeMax: "2026-08-12T00:00:00.000Z" };

type FetchInit = { headers: Record<string, string> };

function fakeFetch(response: { ok?: boolean; status?: number; json?: unknown }) {
  const fn = vi.fn(async (_url: string, _init?: FetchInit) => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.json ?? {},
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("createCalendarClient", () => {
  it("exposes only the list method", () => {
    expect(Object.keys(createCalendarClient(TOKEN))).toEqual(["listEvents"]);
  });

  it("requests single events in the given window, ordered by start", async () => {
    const fetchMock = fakeFetch({ json: { items: [] } });
    await createCalendarClient(TOKEN).listEvents(RANGE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("timeMin=2026-08-11T00%3A00%3A00.000Z");
    expect(url).toContain("timeMax=2026-08-12T00%3A00%3A00.000Z");
    expect(url).toContain("singleEvents=true");
    expect(url).toContain("orderBy=startTime");
    expect(init?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("reduces attendees to a count and never returns their emails", async () => {
    fakeFetch({ json: { items: [{
      id: "e1", summary: "Weekly check-in",
      start: { dateTime: "2026-08-11T14:00:00Z" },
      attendees: [
        { email: "parent@example.com" },
        { email: "tutor@demo.test" },
      ],
    }] } });

    const events = await createCalendarClient(TOKEN).listEvents(RANGE);

    expect(events).toEqual([{
      id: "e1", title: "Weekly check-in", start: "2026-08-11T14:00:00Z", attendeeCount: 2,
    }]);
    expect(JSON.stringify(events)).not.toContain("@");
  });

  it("counts an event with no attendees as zero", async () => {
    fakeFetch({ json: { items: [{ id: "e2", summary: "Focus block", start: { dateTime: "2026-08-11T09:00:00Z" } }] } });
    const [event] = await createCalendarClient(TOKEN).listEvents(RANGE);
    expect(event.attendeeCount).toBe(0);
  });

  it("falls back to the all-day date when an event has no start time", async () => {
    fakeFetch({ json: { items: [{ id: "e3", start: { date: "2026-08-11" } }] } });
    const [event] = await createCalendarClient(TOKEN).listEvents(RANGE);
    expect(event.start).toBe("2026-08-11");
    expect(event.title).toBeNull();
  });

  it("returns an empty list when the response carries no items", async () => {
    fakeFetch({ json: {} });
    expect(await createCalendarClient(TOKEN).listEvents(RANGE)).toEqual([]);
  });

  it("throws with the status when the request fails", async () => {
    fakeFetch({ ok: false, status: 401 });
    await expect(createCalendarClient(TOKEN).listEvents(RANGE)).rejects.toThrow(/401/);
  });
});
