import { describe, expect, it } from "vitest";
import { oraPilotPresentation } from "./ora-certification-presentation";

const base = {
  certifier: { slug: "ora" },
  protocol: { seriesKey: "scientific-merit-pilot", version: "0.1.0" },
  lifecycleState: "issued",
};

describe("ORA pilot presentation", () => {
  it.each([
    ["certified", "ORA Certified · Pilot"],
    ["certified-with-conditions", "ORA Certified with conditions · Pilot"],
    ["not-certified", "ORA Not certified · Pilot"],
    ["inconclusive", "ORA Assessment inconclusive · Pilot"],
  ])("labels %s without truth language", (outcome, label) => {
    expect(oraPilotPresentation({ ...base, outcome })).toEqual({ label, active: true });
    expect(label).not.toMatch(/true|scientifically valid|trusted/i);
  });

  it("does not present withdrawn, revoked, or superseded results as current", () => {
    for (const lifecycleState of ["withdrawn", "revoked", "superseded"]) {
      expect(oraPilotPresentation({ ...base, outcome: "certified", lifecycleState })).toEqual({
        label: `ORA assessment · Pilot · ${lifecycleState}`,
        active: false,
      });
    }
  });

  it("does not brand an independent certifier as ORA", () => {
    expect(
      oraPilotPresentation({ ...base, certifier: { slug: "independent" }, outcome: "certified" }),
    ).toBeNull();
  });
});
