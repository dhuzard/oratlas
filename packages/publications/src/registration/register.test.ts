import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSafeArtifactFetcher, OperationBudget } from "@oratlas/safe-fetch";
import {
  FIXTURE_URL_SAFETY_POLICY,
  startFixtureSite,
  type FixtureSite,
} from "@oratlas/safe-fetch/testing";
import {
  buildPublicationFixture,
  FIXTURE_CLAIM_ID,
  FIXTURE_DOCUMENT_PATH,
  type PublicationFixture,
} from "../testing/index.js";
import { PublicationRegistrationError } from "./errors.js";
import { registerPublicationFromManifest, type PublicationObservation } from "./register.js";
import { type PublicationSourceDocumentResolver } from "./source-bytes.js";
import { type PublicationArtifactFetcher } from "./fetcher.js";

/**
 * Registration, exercised against a real local HTTP server serving a real
 * externally hosted MyST publication. Every input is treated as adversarial:
 * the manifest, the digests, the counts, the paths, the redirect chain and the
 * declared source all come from a host ORAtlas does not control.
 *
 * Required CI never touches the public internet: the fixture binds to
 * loopback, and the only policy that can reach it is one a test opts into.
 */

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  ".json": "application/json",
  ".jsonl": "application/jsonl",
};

let site: FixtureSite;
let fixture: PublicationFixture;

function publish(files: Record<string, string>): void {
  for (const [path, body] of Object.entries(files)) {
    const extension = path.slice(path.lastIndexOf("."));
    site.routes.set(path, {
      body,
      headers: { "content-type": MEDIA_TYPE_BY_EXTENSION[extension] ?? "application/json" },
    });
  }
}

function fetcher(): PublicationArtifactFetcher {
  return createSafeArtifactFetcher({
    policy: FIXTURE_URL_SAFETY_POLICY,
    budget: new OperationBudget(20_000),
  });
}

async function register(
  overrides: Partial<Parameters<typeof registerPublicationFromManifest>[0]> = {},
): Promise<PublicationObservation> {
  return registerPublicationFromManifest({
    manifestUrl: site.url(fixture.manifestPath),
    publicationType: "research-article",
    fetcher: fetcher(),
    now: () => new Date("2026-08-28T09:00:00.000Z"),
    ...overrides,
  });
}

async function expectRefusal(
  promise: Promise<unknown>,
): Promise<PublicationRegistrationError> {
  try {
    await promise;
  } catch (error) {
    expect(error, String(error)).toBeInstanceOf(PublicationRegistrationError);
    return error as PublicationRegistrationError;
  }
  throw new Error("Expected the registration to be refused.");
}

/** A resolver that holds the exact source bytes the fixture was built from. */
function sourceResolver(
  documents: Record<string, string>,
  overrides: Partial<PublicationSourceDocumentResolver> = {},
): PublicationSourceDocumentResolver {
  return {
    name: "fixture-source",
    supports: () => ({ supported: true }) as const,
    readDocument: async (_source, documentPath) => {
      const text = documents[documentPath];
      if (text === undefined) return { ok: false, reason: "source-document-unavailable" as const };
      return { ok: true as const, text };
    },
    ...overrides,
  };
}

beforeEach(async () => {
  fixture = buildPublicationFixture();
  site = await startFixtureSite();
  publish(fixture.files);
});

afterEach(async () => {
  await site.close();
});

describe("registering a valid external MyST publication", () => {
  it("captures the bytes, validates the structure and materializes source occurrences", async () => {
    const observation = await register();

    expect(observation.structuralProvenance).toBe("published-structure");
    expect(observation.sourceVerification).toEqual({
      outcome: "unavailable",
      reason: "no-source-declared",
    });
    expect(observation.normalized.occurrences).toHaveLength(2);
    expect(observation.normalized.publication.recordSource).toBe("external-publication");
    expect(observation.normalized.version.sourcesSha256).toBe(fixture.sourcesSha256);
    // A source occurrence is never a canonical claim identity.
    expect(observation.normalized.occurrences[0]!.stableKey).toMatch(
      /^publication-claim-occurrence:v1:[0-9a-f]{64}$/,
    );
  });

  it("retains exactly the bytes it saw, with digests it recomputed", async () => {
    const { capture } = await register();

    expect(capture.requestedManifestUrl).toBe(site.url(fixture.manifestPath));
    expect(capture.resolvedManifestUrl).toBe(site.url(fixture.manifestPath));
    expect(capture.manifestSha256).toBe(
      createHash("sha256").update(fixture.files[fixture.manifestPath]!, "utf8").digest("hex"),
    );
    expect(capture.declaredSchemaVersion).toBe("0.2.0");
    expect(capture.adapterType).toBe("myst");
    expect(capture.sourceLocalPublicationId).toBe("adolescent-stress-review");
    expect(capture.sourcesSha256).toBe(fixture.sourcesSha256);

    const kinds = capture.artifacts.map((artifact) => artifact.kind).sort();
    expect(kinds).toEqual(["claim-stream", "cross-reference-inventory", "publication-manifest"]);

    const claimStream = capture.artifacts.find((artifact) => artifact.kind === "claim-stream")!;
    expect(claimStream.text).toBe(fixture.claimsJsonl);
    expect(claimStream.declaredSha256).toBe(claimStream.sha256);
    expect(claimStream.provenance.status).toBe(200);
    expect(claimStream.provenance.finalUrl).toBe(site.url("/adolescent-stress/oratlas/claims.jsonl"));
  });

  it("reaches published-structure without ever reading the publication source", async () => {
    // The deployed site does not serve its Markdown; nothing in the fixture's
    // published files is a source document.
    expect(Object.keys(fixture.files).some((path) => path.endsWith(".md"))).toBe(false);
    const observation = await register();
    expect(observation.structuralProvenance).toBe("published-structure");
    expect(site.requests.some((path) => path.endsWith(".md"))).toBe(false);
  });

  it("resolves a subpath deployment's published URLs without losing the prefix", async () => {
    const observation = await register();
    // The inventory URL is site-root-relative ("/results"); resolving it
    // naively against the canonical URL would drop "/adolescent-stress".
    expect(new URL("/results", "https://example.org/adolescent-stress/").href).toBe(
      "https://example.org/results",
    );
    for (const location of observation.publishedLocations) {
      expect(location.publishedUrl).toBe(
        `https://example.org/adolescent-stress/results#${location.sourceLocalClaimId}`,
      );
      expect(location.pageDataVerified).toBe(true);
    }
  });

  it("fetches artifacts from where the manifest was served, never from the declared canonical URL", async () => {
    await register();
    // Every retrieval stayed under the observed deployment path.
    for (const path of site.requests) expect(path.startsWith("/adolescent-stress/")).toBe(true);
    expect(site.requests).toContain("/adolescent-stress/content/results.json");
  });
});

describe("manifest compatibility, fail-closed", () => {
  it("refuses invalid JSON", async () => {
    site.routes.set(fixture.manifestPath, {
      body: "{ not json",
      headers: { "content-type": "application/json" },
    });
    expect((await expectRefusal(register())).code).toBe("manifest-invalid-json");
  });

  it("refuses a schema version it does not implement, rather than partially reading it", async () => {
    publish({
      [fixture.manifestPath]: JSON.stringify({ ...fixture.manifest, schemaVersion: "0.3.0" }),
    });
    const refusal = await expectRefusal(register());
    expect(refusal.code).toBe("manifest-schema-unsupported");
    expect(refusal.detail).toContain("0.3.0");
  });

  it("refuses an unknown key: the manifest object is closed", async () => {
    publish({
      [fixture.manifestPath]: JSON.stringify({ ...fixture.manifest, extra: "surprise" }),
    });
    expect((await expectRefusal(register())).code).toBe("manifest-invalid");
  });

  it("refuses an adapter type it does not implement", async () => {
    publish({
      [fixture.manifestPath]: JSON.stringify({
        ...fixture.manifest,
        adapter: { type: "quarto", xref: "quarto.xref.json" },
      }),
    });
    expect((await expectRefusal(register())).code).toBe("adapter-not-supported");
  });

  it("refuses an unsafe declared path without resolving it", async () => {
    for (const path of ["../../etc/passwd", "/etc/passwd", "./oratlas/claims.jsonl", "a:b"]) {
      publish({
        [fixture.manifestPath]: JSON.stringify({
          ...fixture.manifest,
          artifacts: {
            claims: {
              ...(fixture.manifest.artifacts as { claims: Record<string, unknown> }).claims,
              path,
            },
          },
        }),
      });
      const refusal = await expectRefusal(register());
      expect(refusal.code, path).toBe("artifact-path-unsafe");
    }
    expect(site.requests.filter((request) => request.includes("passwd"))).toEqual([]);
  });

  it("refuses a declared record count beyond what it will read", async () => {
    publish({
      [fixture.manifestPath]: JSON.stringify({
        ...fixture.manifest,
        artifacts: {
          claims: {
            ...(fixture.manifest.artifacts as { claims: Record<string, unknown> }).claims,
            records: 10_000,
          },
        },
      }),
    });
    expect((await expectRefusal(register({ limits: { maxClaimRecords: 10 } }))).code).toBe(
      "limit-exceeded",
    );
  });
});

describe("artifact integrity, fail-closed", () => {
  it("refuses a claim stream whose digest does not match the declaration", async () => {
    publish({
      "/adolescent-stress/oratlas/claims.jsonl": fixture.claimsJsonl.replace(
        "Persistent",
        "Persistant",
      ),
    });
    expect((await expectRefusal(register())).code).toBe("artifact-digest-mismatch");
  });

  it("refuses a record count that disagrees with the artifact", async () => {
    const single = fixture.claimsJsonl.split("\n")[0]! + "\n";
    publish({
      "/adolescent-stress/oratlas/claims.jsonl": single,
      [fixture.manifestPath]: JSON.stringify({
        ...fixture.manifest,
        artifacts: {
          claims: {
            ...(fixture.manifest.artifacts as { claims: Record<string, unknown> }).claims,
            records: 2,
            sha256: createHash("sha256").update(single, "utf8").digest("hex"),
          },
        },
      }),
    });
    expect((await expectRefusal(register())).code).toBe("artifact-record-count-mismatch");
  });

  it("refuses malformed JSON Lines", async () => {
    for (const body of [
      "{}\nnot json\n",
      `${fixture.claimsJsonl.trimEnd()}`,
      `${fixture.claimsJsonl}\n`,
      "﻿{}\n",
    ]) {
      publish({
        "/adolescent-stress/oratlas/claims.jsonl": body,
        [fixture.manifestPath]: JSON.stringify({
          ...fixture.manifest,
          artifacts: {
            claims: {
              ...(fixture.manifest.artifacts as { claims: Record<string, unknown> }).claims,
              sha256: createHash("sha256").update(body, "utf8").digest("hex"),
            },
          },
        }),
      });
      const refusal = await expectRefusal(register());
      expect(["artifact-malformed", "artifact-record-count-mismatch"]).toContain(refusal.code);
    }
  });

  it("refuses a duplicate source-local claim id", async () => {
    const first = fixture.claimsJsonl.split("\n")[0]!;
    const duplicated = `${first}\n${first}\n`;
    publish({
      "/adolescent-stress/oratlas/claims.jsonl": duplicated,
      [fixture.manifestPath]: JSON.stringify({
        ...fixture.manifest,
        artifacts: {
          claims: {
            ...(fixture.manifest.artifacts as { claims: Record<string, unknown> }).claims,
            records: 2,
            sha256: createHash("sha256").update(duplicated, "utf8").digest("hex"),
          },
        },
      }),
    });
    expect((await expectRefusal(register())).code).toBe("duplicate-source-local-claim-id");
  });

  it("refuses a claim record that is not a valid record of the declared schema", async () => {
    const records = fixture.claimRecords.map((record) => ({ ...record }));
    (records[0] as Record<string, unknown>).claimType = "vibes";
    const body = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    publish({
      "/adolescent-stress/oratlas/claims.jsonl": body,
      [fixture.manifestPath]: JSON.stringify({
        ...fixture.manifest,
        artifacts: {
          claims: {
            ...(fixture.manifest.artifacts as { claims: Record<string, unknown> }).claims,
            sha256: createHash("sha256").update(body, "utf8").digest("hex"),
          },
        },
      }),
    });
    expect((await expectRefusal(register())).code).toBe("claim-record-invalid");
  });
});

describe("published-structure verification", () => {
  it("refuses a claim whose target is absent from the inventory", async () => {
    publish({
      "/adolescent-stress/myst.xref.json": JSON.stringify({
        references: [{ kind: "page", url: "/results", data: "/content/results.json" }],
      }),
    });
    const refusal = await expectRefusal(register());
    expect(refusal.code).toBe("cross-reference-target-missing");
    expect(refusal.detail).toContain(FIXTURE_CLAIM_ID);
  });

  it("refuses a claim the published page data does not structurally contain", async () => {
    publish({
      "/adolescent-stress/content/results.json": JSON.stringify({
        version: 1,
        mdast: { type: "root", children: [{ type: "paragraph" }] },
      }),
    });
    expect((await expectRefusal(register())).code).toBe("page-data-claim-node-missing");
  });

  it("refuses an unreadable inventory", async () => {
    publish({ "/adolescent-stress/myst.xref.json": JSON.stringify({ references: "many" }) });
    expect((await expectRefusal(register())).code).toBe("cross-reference-inventory-invalid");
  });

  it("warns, rather than failing, when the inventory names no page data", async () => {
    publish({
      "/adolescent-stress/myst.xref.json": JSON.stringify({
        references: fixture.claimRecords.map((record) => ({
          identifier: (record.target as { identifier: string }).identifier,
          url: "/results",
        })),
      }),
    });
    const observation = await register();
    expect(observation.warnings.map((warning) => warning.code)).toContain(
      "cross-reference-entry-declares-no-page-data",
    );
    expect(observation.publishedLocations.every((location) => !location.pageDataVerified)).toBe(
      true,
    );
  });

  it("records a canonical URL that is not the location the bytes came from", async () => {
    const observation = await register();
    expect(observation.warnings.map((warning) => warning.code)).toContain(
      "canonical-url-differs-from-observed-location",
    );
  });
});

describe("network hostility", () => {
  it("refuses a manifest URL the outbound policy will not accept", async () => {
    const refusal = await expectRefusal(
      registerPublicationFromManifest({
        manifestUrl: "http://169.254.169.254/oratlas.manifest.json",
        publicationType: "research-article",
        fetcher: fetcher(),
      }),
    );
    expect(refusal.code).toBe("manifest-url-rejected");
  });

  it("refuses plaintext http under the production policy", async () => {
    const refusal = await expectRefusal(
      registerPublicationFromManifest({
        manifestUrl: site.url(fixture.manifestPath),
        publicationType: "research-article",
        fetcher: createSafeArtifactFetcher({}),
      }),
    );
    expect(refusal.code).toBe("manifest-url-rejected");
  });

  it("refuses a manifest that redirects into a private network", async () => {
    site.routes.set("/redirect.json", { redirectTo: "http://10.1.2.3/oratlas.manifest.json" });
    const refusal = await expectRefusal(
      registerPublicationFromManifest({
        manifestUrl: site.url("/redirect.json"),
        publicationType: "research-article",
        fetcher: fetcher(),
      }),
    );
    expect(refusal.code).toBe("manifest-unreachable");
  });

  it("refuses an oversized artifact", async () => {
    expect((await expectRefusal(register({ limits: { maxManifestBytes: 32 } }))).code).toBe(
      "manifest-unreachable",
    );
  });

  it("refuses an excessive redirect chain", async () => {
    for (let hop = 0; hop < 8; hop += 1) {
      site.routes.set(`/hop-${hop}`, { redirectTo: `/hop-${hop + 1}` });
    }
    const refusal = await expectRefusal(
      registerPublicationFromManifest({
        manifestUrl: site.url("/hop-0"),
        publicationType: "research-article",
        fetcher: fetcher(),
      }),
    );
    expect(refusal.code).toBe("manifest-unreachable");
  });

  it("refuses an artifact served with a hostile content type", async () => {
    site.routes.set("/adolescent-stress/oratlas/claims.jsonl", {
      body: "<html><script>fetch('/admin')</script></html>",
      headers: { "content-type": "text/html" },
    });
    expect((await expectRefusal(register())).code).toBe("artifact-unreachable");
  });

  it("follows a bounded redirect to the real manifest and captures where it landed", async () => {
    site.routes.set("/manifest.json", { redirectTo: fixture.manifestPath });
    const observation = await registerPublicationFromManifest({
      manifestUrl: site.url("/manifest.json"),
      publicationType: "research-article",
      fetcher: fetcher(),
    });
    expect(observation.capture.requestedManifestUrl).toBe(site.url("/manifest.json"));
    expect(observation.capture.resolvedManifestUrl).toBe(site.url(fixture.manifestPath));
    // Artifacts resolve against where the manifest actually landed.
    expect(observation.capture.observedSiteRootUrl).toBe(site.url("/adolescent-stress/"));
  });
});

describe("declaration authority", () => {
  it("honours a review manifest that owns the claim declarations", async () => {
    fixture = buildPublicationFixture({
      declarations: "review-manifest",
      reviewManifestPath: "review-manifest.json",
    });
    publish(fixture.files);

    const observation = await register();
    expect(
      observation.normalized.occurrences.every(
        (occurrence) => occurrence.declaration.authority === "review-manifest",
      ),
    ).toBe(true);
    expect(observation.warnings.map((warning) => warning.code)).toContain(
      "review-manifest-captured-not-interpreted",
    );
    expect(observation.capture.artifacts.map((artifact) => artifact.kind)).toContain(
      "review-manifest",
    );
  });

  it("refuses two artifacts claiming authority over the same declarations", async () => {
    fixture = buildPublicationFixture({
      declarations: "publication-source",
      reviewManifestPath: "review-manifest.json",
    });
    publish(fixture.files);
    expect((await expectRefusal(register())).code).toBe("declaration-authority-conflict");
  });

  it("refuses delegation to a review manifest that is not declared", async () => {
    fixture = buildPublicationFixture({ declarations: "review-manifest" });
    publish(fixture.files);
    expect((await expectRefusal(register())).code).toBe("declaration-authority-conflict");
  });

  it("refuses delegation to a review manifest that declares no claim stream", async () => {
    fixture = buildPublicationFixture({
      declarations: "review-manifest",
      reviewManifestPath: "review-manifest.json",
      reviewManifest: { schemaVersion: "1.0.0", review: { title: "No claims here" } },
    });
    publish(fixture.files);
    expect((await expectRefusal(register())).code).toBe("declaration-authority-conflict");
  });
});

describe("source-byte verification", () => {
  const gitSource = {
    type: "git",
    repository: "https://github.com/lab/adolescent-stress",
    commit: "a".repeat(40),
  };

  it("reaches source-byte when the exact source bytes verify", async () => {
    fixture = buildPublicationFixture({ source: gitSource });
    publish(fixture.files);

    const observation = await register({
      sourceResolver: sourceResolver(fixture.sourceDocuments),
    });

    expect(observation.structuralProvenance).toBe("source-byte");
    expect(observation.sourceVerification).toEqual({
      outcome: "reached",
      sourceType: "git",
      resolver: "fixture-source",
      documentsChecked: 1,
    });
    expect(observation.normalized.version.structuralProvenance).toBe("source-byte");
  });

  it("does not masquerade as source-byte when the source cannot be obtained", async () => {
    fixture = buildPublicationFixture({ source: gitSource });
    publish(fixture.files);

    const observation = await register({
      sourceResolver: sourceResolver({}),
    });

    expect(observation.structuralProvenance).toBe("published-structure");
    expect(observation.sourceVerification).toEqual({
      outcome: "unavailable",
      reason: "source-document-unavailable",
      sourceType: "git",
    });
    expect(observation.warnings.map((warning) => warning.code)).toContain(
      "source-byte-verification-not-reached",
    );
  });

  it("records why an unsupported source type was not attempted", async () => {
    fixture = buildPublicationFixture({
      source: { type: "doi", versionDoi: "10.5281/zenodo.1234567" },
    });
    publish(fixture.files);

    const observation = await register({
      sourceResolver: sourceResolver(fixture.sourceDocuments, {
        supports: () => ({ reason: "source-type-not-supported" }) as const,
      }),
    });

    expect(observation.structuralProvenance).toBe("published-structure");
    expect(observation.sourceVerification).toEqual({
      outcome: "unavailable",
      reason: "source-type-not-supported",
      sourceType: "doi",
    });
  });

  it("refuses, rather than downgrading, when obtained source bytes disagree", async () => {
    fixture = buildPublicationFixture({ source: gitSource });
    publish(fixture.files);

    const tampered = {
      [FIXTURE_DOCUMENT_PATH]: `${fixture.sourceDocuments[FIXTURE_DOCUMENT_PATH]!}\nedited\n`,
    };
    const refusal = await expectRefusal(
      register({ sourceResolver: sourceResolver(tampered) }),
    );
    expect(refusal.code).toBe("source-verification-mismatch");
  });

  it("stays at published-structure when no resolver is configured", async () => {
    fixture = buildPublicationFixture({ source: gitSource });
    publish(fixture.files);

    const observation = await register();
    expect(observation.structuralProvenance).toBe("published-structure");
    expect(observation.sourceVerification).toEqual({
      outcome: "unavailable",
      reason: "no-source-resolver-configured",
      sourceType: "git",
    });
  });
});

describe("capture identity and idempotency", () => {
  it("produces the same capture key for an unchanged publication", async () => {
    const first = await register();
    const second = await register();
    expect(second.capture.captureKey).toBe(first.capture.captureKey);
    expect(second.normalized.version.stableKey).toBe(first.normalized.version.stableKey);
  });

  it("produces a different capture and version when the site is republished", async () => {
    const first = await register();

    const republished = buildPublicationFixture({
      claims: [
        {
          id: FIXTURE_CLAIM_ID,
          body: "Persistent behavioural change after adolescent stress is mediated by altered HPA reactivity, revised.",
          claimType: "mechanistic",
        },
      ],
    });
    fixture = republished;
    site.routes.clear();
    publish(republished.files);

    const second = await register();
    expect(second.capture.captureKey).not.toBe(first.capture.captureKey);
    expect(second.normalized.version.sourcesSha256).not.toBe(
      first.normalized.version.sourcesSha256,
    );
    expect(second.normalized.version.stableKey).not.toBe(first.normalized.version.stableKey);
    // One publication, two versions: identity survives republication.
    expect(second.normalized.publication.stableKey).toBe(first.normalized.publication.stableKey);
  });

  it("keys a capture to the URL it was observed at, so two URLs never share one", async () => {
    const first = await register();
    site.routes.set("/mirror/oratlas.manifest.json", {
      body: fixture.files[fixture.manifestPath]!,
      headers: { "content-type": "application/json" },
    });
    site.routes.set("/mirror/oratlas/claims.jsonl", {
      body: fixture.claimsJsonl,
      headers: { "content-type": "application/jsonl" },
    });
    site.routes.set("/mirror/myst.xref.json", {
      body: fixture.files["/adolescent-stress/myst.xref.json"]!,
      headers: { "content-type": "application/json" },
    });
    site.routes.set("/mirror/content/results.json", {
      body: fixture.files["/adolescent-stress/content/results.json"]!,
      headers: { "content-type": "application/json" },
    });

    const mirrored = await registerPublicationFromManifest({
      manifestUrl: site.url("/mirror/oratlas.manifest.json"),
      publicationType: "research-article",
      fetcher: fetcher(),
    });
    expect(mirrored.capture.captureKey).not.toBe(first.capture.captureKey);
    // The same publication, observed at a second location, keeps one identity.
    expect(mirrored.normalized.publication.stableKey).toBe(first.normalized.publication.stableKey);
    expect(mirrored.normalized.version.stableKey).toBe(first.normalized.version.stableKey);
  });
});
