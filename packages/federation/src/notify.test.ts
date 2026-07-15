import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  ACTIVITY_STREAMS_CONTEXT,
  COAR_NOTIFY_CONTEXT,
  buildAnnounceReview,
  parseCoarNotifyActivity,
} from "./notify.js";

const requestReview = {
  "@context": [ACTIVITY_STREAMS_CONTEXT, COAR_NOTIFY_CONTEXT],
  actor: { id: "https://orcid.org/0000-0002-1825-0097", name: "Reviewer", type: "Person" },
  id: "urn:uuid:0370c0fb-bb78-4a9b-87f5-bed307a509dd",
  object: {
    id: "https://repository.example/preprint/421",
    "ietf:cite-as": "https://doi.org/10.5555/12345680",
    "ietf:item": {
      id: "https://repository.example/preprint/421/content.pdf",
      mediaType: "application/pdf",
      type: ["Article", "sorg:ScholarlyArticle"],
    },
    type: ["Page", "sorg:AboutPage"],
  },
  origin: {
    id: "https://repository.example/system",
    inbox: "https://repository.example/inbox",
    type: "Service",
  },
  target: {
    id: "https://oratlas.example/system",
    inbox: "https://oratlas.example/api/federation/inbox",
    type: "Service",
  },
  type: ["Offer", "coar-notify:ReviewAction"],
};

function expectZodFailure(payload: unknown): void {
  let thrown: unknown;
  try {
    parseCoarNotifyActivity(payload);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ZodError);
  expect(thrown).not.toBeInstanceOf(RangeError);
}

describe("COAR Notify review federation", () => {
  it("normalizes a conforming Request Review without fetching its URLs", () => {
    expect(parseCoarNotifyActivity(requestReview)).toMatchObject({
      pattern: "request-review",
      activityId: requestReview.id,
      actorId: requestReview.actor.id,
      objectId: requestReview.object.id,
    });
  });

  it("accepts the recommended actor being absent", () => {
    const { actor: _actor, ...withoutActor } = requestReview;
    expect(parseCoarNotifyActivity(withoutActor)).toMatchObject({
      pattern: "request-review",
      actorId: undefined,
    });
  });

  it("pins context order and rejects duplicate or semantic-override contexts", () => {
    expect(() =>
      parseCoarNotifyActivity({
        ...requestReview,
        "@context": [COAR_NOTIFY_CONTEXT, ACTIVITY_STREAMS_CONTEXT],
      }),
    ).toThrow();
    expect(() =>
      parseCoarNotifyActivity({
        ...requestReview,
        "@context": [ACTIVITY_STREAMS_CONTEXT, ACTIVITY_STREAMS_CONTEXT],
      }),
    ).toThrow();
    expect(() =>
      parseCoarNotifyActivity({
        ...requestReview,
        "@context": [
          ACTIVITY_STREAMS_CONTEXT,
          COAR_NOTIFY_CONTEXT,
          "https://attacker.example/context",
        ],
      }),
    ).toThrow();
    expect(() =>
      parseCoarNotifyActivity({
        ...requestReview,
        object: {
          ...requestReview.object,
          "@context": "https://attacker.example/context",
        },
      }),
    ).toThrow();
  });

  it("preserves absolute-IRI extension properties without remote context dereferencing", () => {
    const payload = {
      ...requestReview,
      "https://example.org/ns/editorialWorkflow": {
        type: "Object",
        "https://example.org/ns/state": "screened",
        "https://example.org/ns/flags": [null, true, 42],
      },
      object: {
        ...requestReview.object,
        "https://example.org/ns/repositoryWorkflow": ["screened", "accepted"],
      },
    };
    expect(parseCoarNotifyActivity(payload).payload).toMatchObject({
      "https://example.org/ns/editorialWorkflow": {
        type: "Object",
        "https://example.org/ns/state": "screened",
        "https://example.org/ns/flags": [null, true, 42],
      },
      object: {
        "https://example.org/ns/repositoryWorkflow": ["screened", "accepted"],
      },
    });
  });

  it("rejects unknown bare properties and JSON-LD keywords recursively", () => {
    const invalidPayloads = [
      { ...requestReview, extension: "unqualified" },
      { ...requestReview, "@graph": [] },
      {
        ...requestReview,
        object: { ...requestReview.object, workflow: "unqualified" },
      },
      {
        ...requestReview,
        object: { ...requestReview.object, "@id": "https://attacker.example/override" },
      },
      {
        ...requestReview,
        "https://example.org/ns/editorialWorkflow": { workflow: "still-unqualified" },
      },
    ];

    for (const payload of invalidPayloads) {
      expect(() => parseCoarNotifyActivity(payload)).toThrow();
    }
  });

  it("rejects direct and indirect extension cycles with Zod issues", () => {
    const selfCycle: Record<string, unknown> = {};
    selfCycle["https://example.org/ns/self"] = selfCycle;
    expectZodFailure({
      ...requestReview,
      "https://example.org/ns/extension": selfCycle,
    });

    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = {};
    first["https://example.org/ns/next"] = second;
    second["https://example.org/ns/next"] = first;
    expectZodFailure({
      ...requestReview,
      "https://example.org/ns/extension": first,
    });
  });

  it("rejects extension values beyond deterministic depth and node budgets", () => {
    let deeplyNested: unknown = "leaf";
    for (let depth = 0; depth < 70; depth += 1) {
      deeplyNested = { [`https://example.org/ns/level-${depth}`]: deeplyNested };
    }
    expectZodFailure({
      ...requestReview,
      "https://example.org/ns/extension": deeplyNested,
    });

    expectZodFailure({
      ...requestReview,
      "https://example.org/ns/extension": Array.from({ length: 10_001 }, () => null),
    });
  });

  it("rejects non-JSON primitives and non-plain extension objects", () => {
    class UnsafeValue {}
    const unsafeValues: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1n,
      () => "not JSON",
      Symbol("not-json"),
      new Date("2026-07-15T00:00:00Z"),
      new Map([["state", "screened"]]),
      new UnsafeValue(),
    ];

    for (const value of unsafeValues) {
      expectZodFailure({
        ...requestReview,
        "https://example.org/ns/unsafe": value,
      });
    }
  });

  it("fails closed when contexts, content metadata, or review action type are absent", () => {
    expect(() =>
      parseCoarNotifyActivity({ ...requestReview, "@context": [ACTIVITY_STREAMS_CONTEXT] }),
    ).toThrow();
    expect(() => parseCoarNotifyActivity({ ...requestReview, type: ["Offer"] })).toThrow();
    expect(() =>
      parseCoarNotifyActivity({
        ...requestReview,
        object: { ...requestReview.object, type: ["sorg:AboutPage"] },
      }),
    ).toThrow();
    expect(() =>
      parseCoarNotifyActivity({
        ...requestReview,
        object: { id: requestReview.object.id, type: "Page" },
      }),
    ).toThrow();
  });

  it("rejects unsupported and oversized values", () => {
    expect(() => parseCoarNotifyActivity({ ...requestReview, type: ["Create"] })).toThrow();
    expect(() =>
      parseCoarNotifyActivity({ ...requestReview, id: `urn:uuid:${"x".repeat(3_000)}` }),
    ).toThrow();
  });

  it("builds and re-validates an Announce Review payload", () => {
    const payload = buildAnnounceReview({
      activityId: "urn:uuid:94ecae35-dcfd-4182-8550-22c7164fe23f",
      actor: { id: "https://oratlas.example/system", name: "Open Review Atlas" },
      review: { id: "https://oratlas.example/reviews/demo/versions/v1" },
      reviewedResource: {
        id: requestReview.object.id,
        citeAs: requestReview.object["ietf:cite-as"],
        type: requestReview.object.type,
        item: requestReview.object["ietf:item"],
      },
      origin: {
        id: "https://oratlas.example/system",
        inbox: "https://oratlas.example/api/federation/inbox",
      },
      target: {
        id: "https://repository.example/system",
        inbox: "https://repository.example/inbox",
      },
      inReplyTo: requestReview.id,
    });
    expect(parseCoarNotifyActivity(payload)).toMatchObject({
      pattern: "announce-review",
      contextId: requestReview.object.id,
      inReplyTo: requestReview.id,
    });
  });
});
