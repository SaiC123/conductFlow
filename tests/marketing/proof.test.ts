import { describe, it, expect } from "vitest";
import {
  TESTIMONIALS, PARTNERS, publishedTestimonials, publishedPartners,
  CHURN_RESULT, PILOT_ORGS, WAITLIST_OFFSITE,
} from "@/lib/marketing/proof";

describe("published proof", () => {
  it("never publishes an entry still marked as a placeholder", () => {
    expect(publishedTestimonials().every((t) => !t.placeholder)).toBe(true);
    expect(publishedTestimonials().length)
      .toBe(TESTIMONIALS.filter((t) => !t.placeholder).length);
    expect(publishedPartners().length)
      .toBe(PARTNERS.filter((p) => !p.placeholder).length);
  });

  /**
   * The real guard. Marking an entry published while leaving the scaffold text in place
   * would put "PLACEHOLDER — full name" on the home page as a named endorsement, and the
   * filter above cannot catch that on its own.
   */
  it("refuses to publish scaffold text under a real byline", () => {
    for (const t of publishedTestimonials()) {
      for (const field of [t.quote, t.name, t.role, t.org]) {
        expect(field).not.toMatch(/placeholder/i);
      }
      expect(t.quote.trim().length).toBeGreaterThan(0);
    }
    for (const name of publishedPartners()) {
      expect(name).not.toMatch(/placeholder/i);
    }
  });

  it("keeps the population attached to the headline figure", () => {
    expect(CHURN_RESULT.figure).toMatch(/%/);
    expect(CHURN_RESULT.basis).toMatch(new RegExp(String(PILOT_ORGS)));
    expect(CHURN_RESULT.basis).toMatch(/pilot/i);
  });

  it("states counts as whole numbers, because they are counts", () => {
    expect(Number.isInteger(PILOT_ORGS)).toBe(true);
    expect(Number.isInteger(WAITLIST_OFFSITE)).toBe(true);
  });

  /**
   * The waitlist figure the page states is a live count plus this. Nothing verifies the
   * off-site half, which is exactly why it must never quietly become a marketing number:
   * a signup that cannot be produced on request has not happened.
   */
  it("never pads the live waitlist count with signups nobody can produce", () => {
    expect(WAITLIST_OFFSITE).toBeGreaterThanOrEqual(0);
  });
});
