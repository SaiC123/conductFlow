/**
 * Social proof, in one file, so there is exactly one place to check before a claim goes
 * in front of a customer.
 *
 * Every entry carries `placeholder`. Anything still marked true is filtered out before
 * render — see `publishedTestimonials()`. That is deliberate: a scaffold that renders
 * "Jane Doe, CEO" is one hurried deploy away from being a fabricated endorsement on a
 * public page. Nothing ships until a real person actually said it.
 *
 * To publish one: replace the text, name, role and org with the real words, then set
 * placeholder to false.
 */

export interface Testimonial {
  /** Their words, not a paraphrase. */
  quote: string;
  name: string;
  role: string;
  org: string;
  placeholder: boolean;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "PLACEHOLDER — paste the real quote here, in the words they actually used.",
    name: "PLACEHOLDER — full name",
    role: "PLACEHOLDER — their role",
    org: "PLACEHOLDER — organisation",
    placeholder: true,
  },
  {
    quote: "PLACEHOLDER — paste the real quote here, in the words they actually used.",
    name: "PLACEHOLDER — full name",
    role: "PLACEHOLDER — their role",
    org: "PLACEHOLDER — organisation",
    placeholder: true,
  },
  {
    quote: "PLACEHOLDER — paste the real quote here, in the words they actually used.",
    name: "PLACEHOLDER — full name",
    role: "PLACEHOLDER — their role",
    org: "PLACEHOLDER — organisation",
    placeholder: true,
  },
];

/** Named partner organisations, once they have agreed to be named. Same rule. */
export const PARTNERS: { name: string; placeholder: boolean }[] = [
  { name: "PLACEHOLDER — organisation name", placeholder: true },
  { name: "PLACEHOLDER — organisation name", placeholder: true },
  { name: "PLACEHOLDER — organisation name", placeholder: true },
];

export function publishedTestimonials(): Testimonial[] {
  return TESTIMONIALS.filter((t) => !t.placeholder);
}

export function publishedPartners(): string[] {
  return PARTNERS.filter((p) => !p.placeholder).map((p) => p.name);
}

/**
 * Figures stated as fact on the home page. Counts, not estimates — each one is either
 * true on the day it is written or it does not belong here.
 *
 * The waitlist figure is no longer written here. It is `WAITLIST_OFFSITE` plus a live
 * `select count(*)` through `waitlist_count()` — see lib/marketing/waitlist-count.ts — so
 * it moves the moment someone signs up instead of whenever this file is next edited.
 */
export const PILOT_ORGS = 10;

/**
 * People who joined the waitlist somewhere other than this site — a form filled at an
 * event, a reply to an email, a spreadsheet — and who are therefore invisible to
 * `waitlist_signup`. It is added to the live count.
 *
 * Zero until someone can name the real number. This is the one place in the page's proof
 * where a figure could be inflated without anybody noticing, so it holds only signups that
 * actually happened and could be produced on request. It is not a floor, a target, or a
 * nicer-looking starting point.
 */
export const WAITLIST_OFFSITE = 0;

/**
 * The headline result, measured across the pilot rather than projected. The qualifier is
 * part of the claim, not decoration: "24% better churn" with no population attached is
 * the version a buyer asks awkward questions about.
 */
export const CHURN_RESULT = {
  figure: "24%",
  claim: "better monthly churn",
  basis: `Measured across ${PILOT_ORGS} pilot organisations`,
};
