import { describe, expect, it } from "vitest";
import { validateSameOriginJsonRequest } from "./mutation-request.js";

const base = "https://atlas.example";

function request(headers: Record<string, string>) {
  return new Request(`${base}/api/editorial/trust`, {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("same-origin JSON mutation validation", () => {
  it("accepts an exact same-origin JSON request", () => {
    expect(
      validateSameOriginJsonRequest(
        request({
          Origin: base,
          "Content-Type": "application/json; charset=utf-8",
          "Sec-Fetch-Site": "same-origin",
        }),
        base,
      ),
    ).toEqual({ ok: true });
  });

  it.each([
    ["missing origin", { "Content-Type": "application/json" }, 403],
    ["foreign origin", { Origin: "https://evil.example", "Content-Type": "application/json" }, 403],
    [
      "cross-site fetch metadata",
      { Origin: base, "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
      403,
    ],
    ["form media type", { Origin: base, "Content-Type": "application/x-www-form-urlencoded" }, 415],
    ["missing media type", { Origin: base }, 415],
  ])("rejects %s", (_label, headers, status) => {
    expect(validateSameOriginJsonRequest(request(headers), base)).toMatchObject({
      ok: false,
      status,
    });
  });
});
