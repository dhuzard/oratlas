import { describe, expect, it } from "vitest";
import { isExampleDoi, isZenodoDoi, normalizeDoi, zenodoRecordIdFromDoi } from "./normalize.js";

describe("normalizeDoi", () => {
  it("normalizes all common DOI forms to the bare lower-case DOI", () => {
    const forms = [
      "10.5281/zenodo.1234567",
      "doi:10.5281/zenodo.1234567",
      "DOI: 10.5281/zenodo.1234567",
      "https://doi.org/10.5281/zenodo.1234567",
      "http://dx.doi.org/10.5281/zenodo.1234567",
      "  10.5281/zenodo.1234567.  ",
    ];
    for (const form of forms) {
      const result = normalizeDoi(form);
      expect(result.ok, form).toBe(true);
      expect(result.doi).toBe("10.5281/zenodo.1234567");
    }
  });

  it("lower-cases DOIs (case-insensitive identifiers)", () => {
    expect(normalizeDoi("10.1234/ABC.Def").doi).toBe("10.1234/abc.def");
  });

  it("rejects non-DOIs", () => {
    for (const bad of ["", "not-a-doi", "11.5281/zenodo.1", "10./missing", "https://example.com"]) {
      expect(normalizeDoi(bad).ok, bad).toBe(false);
    }
  });
});

describe("Zenodo helpers", () => {
  it("detects Zenodo DOIs and extracts the record id", () => {
    expect(isZenodoDoi("10.5281/zenodo.9990001")).toBe(true);
    expect(isZenodoDoi("10.1234/other")).toBe(false);
    expect(zenodoRecordIdFromDoi("10.5281/zenodo.9990001")).toBe("9990001");
    expect(zenodoRecordIdFromDoi("10.1234/other")).toBeUndefined();
  });

  it("flags reserved example DOIs", () => {
    expect(isExampleDoi("10.5555/oratlas.example.x")).toBe(true);
    expect(isExampleDoi("10.5281/zenodo.1")).toBe(false);
  });
});
