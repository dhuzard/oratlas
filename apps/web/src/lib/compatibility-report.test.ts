import { describe, expect, it } from "vitest";
import { compatibilityReportFromStoredJson } from "./compatibility-report";

const signal = { detected: false, evidence: [] };
const base = {
  templateForkDetected: signal,
  templateFilesDetected: signal,
  mystProjectDetected: signal,
  bibliographyDetected: signal,
  reviewContentDetected: signal,
  provenanceDetected: signal,
  trustDataDetected: signal,
  releaseDetected: signal,
  doiDetected: signal,
  overallCompatibility: "unsupported",
  levelRationale: [],
  blockingErrors: [],
  warnings: [],
  recommendations: [],
};

const legacy = (overallCompatibility = "unsupported") => ({
  schemaVersion: "1.0.0",
  ...base,
  overallCompatibility,
});

describe("stored compatibility report projection", () => {
  it("prefers immutable version metadata over the legacy snapshot fallback", () => {
    expect(
      compatibilityReportFromStoredJson(
        JSON.stringify({ compatibilityReport: legacy("compatible") }),
        JSON.stringify({ compatibilityReport: legacy("unsupported") }),
      ),
    ).toMatchObject({ schemaVersion: "1.0.0", overallCompatibility: "compatible" });
  });

  it("reads legacy snapshot nesting and withholds malformed storage", () => {
    expect(
      compatibilityReportFromStoredJson(
        JSON.stringify({}),
        JSON.stringify({ compatibilityReport: legacy() }),
      ),
    ).toMatchObject({ schemaVersion: "1.0.0" });
    expect(compatibilityReportFromStoredJson("not-json", "also-not-json")).toBeUndefined();
  });
});
