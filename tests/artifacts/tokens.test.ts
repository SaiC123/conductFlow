import { describe, it, expect } from "vitest";
import { fillTemplate, tokensIn, describeMissing } from "@/lib/artifacts/tokens";

describe("fillTemplate", () => {
  it("substitutes every token it was given a value for", () => {
    const r = fillTemplate("Dear {{client_name}}, due {{deadline}}.", {
      client_name: "Acme", deadline: "3 March",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("Dear Acme, due 3 March.");
  });

  it("tolerates whitespace inside the braces, since a human types these in Drive", () => {
    const r = fillTemplate("Hello {{ client_name }}.", { client_name: "Acme" });
    if (r.ok) expect(r.text).toBe("Hello Acme.");
    else throw new Error("expected a fill");
  });

  it("is case-insensitive about the token name", () => {
    const r = fillTemplate("Hello {{Client_Name}}.", { client_name: "Acme" });
    if (r.ok) expect(r.text).toBe("Hello Acme.");
    else throw new Error("expected a fill");
  });

  it("fills a token repeated in the template every time it appears", () => {
    const r = fillTemplate("{{a}} and {{a}}", { a: "x" });
    if (r.ok) expect(r.text).toBe("x and x");
    else throw new Error("expected a fill");
  });

  it("blocks rather than substituting when a value is absent", () => {
    const r = fillTemplate("Fee: {{fee}}", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["fee"]);
  });

  // The whole point of blocking: a document must never reach a client with a hole in it.
  it("substitutes nothing at all when one token of several is missing", () => {
    const r = fillTemplate("{{client_name}} owes {{fee}}", { client_name: "Acme" });
    expect(r.ok).toBe(false);
  });

  it("treats a blank value as missing, not as a deliberate blank", () => {
    const r = fillTemplate("Fee: {{fee}}", { fee: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["fee"]);
  });

  it("treats null and undefined as missing", () => {
    const r = fillTemplate("{{a}}{{b}}", { a: null, b: undefined });
    if (!r.ok) expect(r.missing).toEqual(["a", "b"]);
    else throw new Error("expected a block");
  });

  it("reports every missing token in one pass, deduplicated and sorted", () => {
    const r = fillTemplate("{{z}} {{a}} {{z}}", {});
    if (!r.ok) expect(r.missing).toEqual(["a", "z"]);
    else throw new Error("expected a block");
  });

  it("ignores a value it was given that the template never asked for", () => {
    const r = fillTemplate("Hi {{a}}", { a: "x", unused: "y" });
    if (r.ok) expect(r.used).toEqual(["a"]);
    else throw new Error("expected a fill");
  });

  it("trims the substituted value", () => {
    const r = fillTemplate("[{{a}}]", { a: "  x  " });
    if (r.ok) expect(r.text).toBe("[x]");
    else throw new Error("expected a fill");
  });

  it("leaves a template with no tokens alone", () => {
    const r = fillTemplate("nothing to fill", {});
    if (r.ok) { expect(r.text).toBe("nothing to fill"); expect(r.used).toEqual([]); }
    else throw new Error("expected a fill");
  });

  // A lone brace pair is not a token, and a half-open one must not eat the rest of the file.
  it("does not treat malformed braces as a token", () => {
    const r = fillTemplate("{{ not a token }} and {single} and {{}}", {});
    expect(r.ok).toBe(true);
  });
});

describe("tokensIn", () => {
  it("lists what a template will need, deduplicated and sorted", () => {
    expect(tokensIn("{{b}} {{a}} {{b}}")).toEqual(["a", "b"]);
  });
});

describe("describeMissing", () => {
  it("reads as a sentence for one token", () => {
    expect(describeMissing(["fee"])).toMatch(/needs \{\{fee\}\}/);
  });

  it("reads as a sentence for several", () => {
    const s = describeMissing(["fee", "start_date"]);
    expect(s).toContain("{{fee}} and {{start_date}}");
  });
});
