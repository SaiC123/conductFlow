import { describe, it, expect, afterEach } from "vitest";
import { authorizedCron } from "@/lib/cron/auth";

const secret = "a-cron-secret-value";

function request(authorization?: string): Request {
  return new Request("https://example.test/api/cron/kek-rewrap", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

afterEach(() => { delete process.env.CRON_SECRET; });

describe("authorizedCron", () => {
  it("accepts the configured secret", () => {
    process.env.CRON_SECRET = secret;
    expect(authorizedCron(request(`Bearer ${secret}`))).toBe(true);
  });

  it("refuses a wrong secret of the same length", () => {
    process.env.CRON_SECRET = secret;
    expect(authorizedCron(request(`Bearer ${"x".repeat(secret.length)}`))).toBe(false);
  });

  it("refuses a request with no authorization at all", () => {
    process.env.CRON_SECRET = secret;
    expect(authorizedCron(request())).toBe(false);
  });

  it("refuses the bare secret without the Bearer scheme", () => {
    process.env.CRON_SECRET = secret;
    expect(authorizedCron(request(secret))).toBe(false);
  });

  it("closes rather than opens when CRON_SECRET is not set", () => {
    expect(authorizedCron(request("Bearer "))).toBe(false);
    expect(authorizedCron(request())).toBe(false);
  });
});
