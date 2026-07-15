import { describe, expect, it } from "vitest";
import {
  replicationBriefCreateSchema,
  replicationBriefTransitionSchema,
  replicationScopeSchema,
} from "./replication.js";

describe("replication marketplace contracts", () => {
  const valid = {
    idempotencyKey: "a02c7f50-c816-4f6d-8a8d-8198dc130671",
    slug: "independent-replay-cohort",
    title: "Independent replay cohort replication",
    summary:
      "A registered replication brief that tests the archived claim in a separately recruited cohort.",
    scope: { population: "adult participants", outcome: "pre-registered recall score" },
    expectedInformationGain:
      "A separately recruited cohort would distinguish repeated analysis of one evidence family from convergence across independent families.",
    effortBand: "medium",
    citationUrls: ["https://doi.org/10.5555/example"],
    claims: [{ reviewVersionId: "version-1", localClaimId: "claim-1" }],
  };

  it("bounds and validates a draft without implying automatic publication", () => {
    expect(replicationBriefCreateSchema.safeParse(valid).success).toBe(true);
    expect(
      replicationBriefCreateSchema.safeParse({
        ...valid,
        citationUrls: ["http://insecure.example/citation"],
      }).success,
    ).toBe(false);
    expect(
      replicationBriefCreateSchema.safeParse({
        ...valid,
        citationUrls: ["https://user:secret@example.org/result?token=secret"],
      }).success,
    ).toBe(false);
    expect(
      replicationBriefCreateSchema.safeParse({
        ...valid,
        citationUrls: ["https://example.org/result?"],
      }).success,
    ).toBe(false);
    expect(
      replicationBriefCreateSchema.safeParse({
        ...valid,
        citationUrls: ["https://example.org/result#"],
      }).success,
    ).toBe(false);
    expect(
      replicationBriefCreateSchema.safeParse({
        ...valid,
        claims: [valid.claims[0], valid.claims[0]],
      }).success,
    ).toBe(false);
  });

  it("canonicalizes public URLs and rejects offline-detectable non-public destinations", () => {
    const canonical = replicationBriefCreateSchema.parse({
      ...valid,
      protocolUrl: "  https://RESEARCH.EXAMPLE.ORG.:443/a/../protocol  ",
      citationUrls: ["https://8.8.8.8:443/evidence"],
    });
    expect(canonical.protocolUrl).toBe("https://research.example.org/protocol");
    expect(canonical.citationUrls).toEqual(["https://8.8.8.8/evidence"]);

    const rejectedHosts = [
      "localhost",
      "review.localhost",
      "intranet",
      "review.internal",
      "review.local",
      "review.test",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "127.1",
      "2130706433",
      "0x7f000001",
      "169.254.1.1",
      "172.16.0.1",
      "192.168.1.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "[::1]",
      "[::]",
      "[::ffff:127.0.0.1]",
      "[fc00::1]",
      "[fe80::1]",
      "[2001:db8::1]",
      "[2002::1]",
      "[ff02::1]",
    ];
    for (const host of rejectedHosts) {
      expect(
        replicationBriefCreateSchema.safeParse({
          ...valid,
          citationUrls: [`https://${host}/evidence`],
        }).success,
        host,
      ).toBe(false);
    }

    expect(
      replicationBriefCreateSchema.safeParse({
        ...valid,
        citationUrls: [
          "https://[2606:4700:4700::1111]/evidence",
          "https://[2001:4860:4860::8888]/evidence",
        ],
      }).success,
    ).toBe(true);
  });

  it("requires explicit scope and guarded lifecycle revisions", () => {
    expect(replicationScopeSchema.safeParse({}).success).toBe(false);
    expect(
      replicationBriefTransitionSchema.safeParse({
        action: "claim",
        expectedRevision: 2,
        protocolUrl: "https://osf.io/example",
        note: "We will register the full protocol before beginning data collection.",
      }).success,
    ).toBe(true);
    expect(
      replicationBriefTransitionSchema.safeParse({
        action: "claim",
        expectedRevision: 2,
        protocolUrl: "https://127.0.0.1/protocol",
        note: "A private destination cannot be registered as the public replication protocol.",
      }).success,
    ).toBe(false);
    expect(
      replicationBriefTransitionSchema.safeParse({ action: "complete", expectedRevision: -1 }),
    ).toMatchObject({ success: false });
  });
});
