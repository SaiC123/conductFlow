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
 * WAITLIST_COUNT is maintained by hand rather than read from `waitlist_signup`, because
 * the table only knows about signups made through this site. Update it when the real
 * number moves.
 */
export const PILOT_ORGS = 10;
export const WAITLIST_COUNT = 132;

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
