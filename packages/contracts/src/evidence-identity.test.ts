import { describe, expect, it } from "vitest";
import {
  canonicalWorkAliases,
  claimDomAnchor,
  decodeUtf16Component,
  encodeUtf16Component,
  findWorkIdentifierConflicts,
  globalCitationId,
  globalClaimId,
} from "./evidence-identity.js";

describe("durable evidence identities", () => {
  it("round-trips every UTF-16 code unit, including lone surrogates", () => {
    const values = ["", "claim:1", "é", "𐐷", "\ud800", "x\udc00y", "\u0000"];
    for (const value of values) {
      expect(decodeUtf16Component(encodeUtf16Component(value))).toBe(value);
      expect(encodeUtf16Component(value)).toMatch(/^(?:[0-9a-f]{4})*$/);
    }
  });

  it("is injective where delimiter and variable-width encodings collide", () => {
    const tricky = ["\u0001\u0010", "\u0010\u0001", "1:2", "12", "\ud800", "\ud801"];
    expect(new Set(tricky.map(encodeUtf16Component)).size).toBe(tricky.length);
  });

  it("namespaces local ids by immutable review version", () => {
    expect(globalClaimId("rv-1", "claim-1")).not.toBe(globalClaimId("rv-2", "claim-1"));
    expect(globalClaimId("rv-1", "same")).not.toBe(globalCitationId("rv-1", "same"));
    expect(claimDomAnchor("rv-1", "claim-1")).not.toBe(claimDomAnchor("rv-1", "claim-2"));
  });
});

describe("canonical scholarly-work aliases", () => {
  it("normalizes DOI, PMID and OpenAlex representations", () => {
    expect(
      canonicalWorkAliases({
        doi: "https://doi.org/10.1000/ABC.X",
        pmid: "PMID: 000123",
        openAlexId: "https://openalex.org/w987/",
      }),
    ).toEqual(["doi:10.1000/abc.x", "pmid:123", "openalex:W987"]);
  });

  it("flags conflicting assertions connected by a shared alias", () => {
    const conflicts = findWorkIdentifierConflicts([
      { citationId: "c1", aliases: ["doi:10.1000/a", "pmid:1"] },
      { citationId: "c2", aliases: ["doi:10.1000/b", "pmid:1"] },
    ]);
    expect(conflicts).toEqual([
      expect.objectContaining({
        citationIds: ["c1", "c2"],
        scheme: "doi",
        values: ["10.1000/a", "10.1000/b"],
      }),
    ]);
  });

  it("does not treat clean repeated aliases as conflicts", () => {
    expect(
      findWorkIdentifierConflicts([
        { citationId: "c1", aliases: ["doi:10.1000/a"] },
        { citationId: "c2", aliases: ["doi:10.1000/a"] },
      ]),
    ).toEqual([]);
  });
});
