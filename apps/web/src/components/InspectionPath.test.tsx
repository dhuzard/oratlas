import { describe, expect, it } from "vitest";
import { formatCountLabel } from "./InspectionPath";

describe("formatCountLabel", () => {
  it("uses the singular label only for a count of one", () => {
    expect(formatCountLabel(1, "claim")).toBe("1 claim");
    expect(formatCountLabel(0, "claim")).toBe("0 claims");
    expect(formatCountLabel(2, "separate record")).toBe("2 separate records");
  });
});
