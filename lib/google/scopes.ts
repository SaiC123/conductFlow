/**
 * Capabilities are asked for one at a time, each with the narrowest scope that does the job.
 * Nobody is asked for Gmail access in order to log in.
 */
export const CAPABILITIES = {
  drive_templates: {
    label: "Use our Drive templates",
    detail: "Reads only the template files you pick — never the rest of your Drive.",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  },
  calendar_context: {
    label: "Read meeting context from Calendar",
    detail: "Reads event titles and times around a conversation. Attendee emails are never stored.",
    scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
  },
  gmail_drafts: {
    label: "Put follow-ups in my Gmail drafts",
    detail: "Writes drafts you send yourself. ConductFlow never sends anything.",
    scopes: ["https://www.googleapis.com/auth/gmail.compose"],
  },
  /**
   * Separate from `calendar_context` rather than widening it. An org that wants meeting
   * context read should not have to grant event writing to get it, and an org that grants
   * this is making a distinctly larger decision that deserves its own answer.
   *
   * `calendar.events` subsumes `calendar.events.readonly`, so an org holding both is not
   * asking Google for anything twice — it is telling ConductFlow two different things.
   *
   * Sensitive, not restricted: this widens the consent screen but does not pull the project
   * into a CASA Tier 2 assessment the way a restricted Gmail read scope would.
   *
   * Document creation needs no entry here. `drive.file` under `drive_templates` already
   * covers copying a picked template, and the copy is app-created, so the Docs API accepts
   * the same token. See lib/google/docs.ts.
   */
  calendar_events: {
    label: "Put meetings on my calendar",
    detail: "Creates events on your own calendar. Guests are never added, so nobody is emailed.",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  },
} as const;

export type Capability = keyof typeof CAPABILITIES;

export function isCapability(value: string): value is Capability {
  return Object.hasOwn(CAPABILITIES, value);
}

/** Identity only. Sign-in never asks for API access. */
export const SIGN_IN_SCOPES = "openid email profile";
