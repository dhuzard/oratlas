import { describe, expect, it, vi } from "vitest";
import { manualOrcidSchema, recognizeManualOrcid } from "./manual-orcid-recognition";

const ORCID = "0000-0002-1825-0097";

describe("manual ORCID recognition without identifier-control verification", () => {
  it("rejects malformed/checksum-invalid inputs without consulting the lookup", async () => {
    const lookup = vi.fn();
    for (const input of [
      null,
      {},
      "",
      "0000-0002-1825-0098",
      `${ORCID}\n`,
      `https://orcid.org/${ORCID}`,
    ]) {
      expect(await recognizeManualOrcid(input, lookup)).toEqual({ status: "invalid" });
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("recognizes only the exact requested valid subject, always ownership unverified", async () => {
    for (const orcid of [ORCID, "0000-0000-0000-001X"]) {
      const lookup = vi.fn().mockResolvedValue({ status: "found", orcid });
      expect(await recognizeManualOrcid(orcid, lookup)).toEqual({
        status: "recognized",
        orcid,
        ownership: "unverified",
      });
      expect(lookup).toHaveBeenCalledExactlyOnceWith(orcid);
      expect(manualOrcidSchema.parse(orcid)).toBe(orcid);
    }
  });

  it("does not confuse an explicit record-not-found with an outage", async () => {
    expect(await recognizeManualOrcid(ORCID, async () => ({ status: "not-found" }))).toEqual({
      status: "not-found",
    });
    expect(await recognizeManualOrcid(ORCID, async () => ({ status: "unavailable" }))).toEqual({
      status: "inconclusive",
    });
  });

  it("fails inconclusively on swapped identities, malformed/overbroad assertions and errors", async () => {
    for (const result of [
      { status: "found", orcid: "0000-0000-0000-001X" },
      { status: "found", orcid: "0000-0002-1825-0098" },
      { status: "found", orcid: ORCID, verified: true },
      { status: "found", orcid: ORCID, access_token: "synthetic-secret" },
      { status: "not-found", profile: "unexpected" },
      { status: "verified", orcid: ORCID },
      {},
      null,
    ])
      expect(await recognizeManualOrcid(ORCID, async () => result)).toEqual({
        status: "inconclusive",
      });
    for (const message of ["timeout", "HTTP 429", "HTTP 500", "synthetic-secret"]) {
      expect(
        await recognizeManualOrcid(ORCID, async () => {
          throw new Error(message);
        }),
      ).toEqual({ status: "inconclusive" });
    }
  });
});
