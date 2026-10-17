import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FakeRepoFixture } from "@oratlas/github";

/**
 * Loader for the pinned Diggypaper → ComputationalReviewTemplate → ORAtlas evidence-lineage fixture
 * (issue #198). Test support only: it reads committed bytes and performs no network access.
 */
export const EVIDENCE_LINEAGE_FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "crt-diggypaper-evidence-lineage",
);

export const REVIEW_REPOSITORY = {
  owner: "Neuronautix",
  name: "ComputationalReviewTemplate_trust-knowledge",
  url: "https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge",
} as const;

/** The review claim that cites two papers and carries the demonstration lineage. */
export const LINEAGE_CLAIM_ID = "clm_7659634fb095cdce";

function readTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[relative(root, path).replaceAll("\\", "/")] = readFileSync(path, "utf8");
    }
  };
  walk(root);
  return files;
}

export interface EvidenceLineageFixture {
  /** Every committed file, keyed by fixture-relative path. */
  all: Record<string, string>;
  /** The review repository as ORAtlas would see it at the pinned commit. */
  reviewFiles: Record<string, string>;
  /** The externally hosted Diggypaper packet (never part of the review repository). */
  packetFiles: Record<string, string>;
  pins: { pins: Record<string, { repository: string; commit: string }> };
  digests: { files: Record<string, { sha256: string; bytes: number }> };
}

export function loadEvidenceLineageFixture(): EvidenceLineageFixture {
  const all = readTree(EVIDENCE_LINEAGE_FIXTURE_DIR);
  const strip = (prefix: string): Record<string, string> =>
    Object.fromEntries(
      Object.entries(all)
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, content]) => [path.slice(prefix.length), content]),
    );
  return {
    all,
    reviewFiles: strip("review-repo/"),
    packetFiles: strip("diggypaper-packet/"),
    pins: JSON.parse(all["pins.json"]!),
    digests: JSON.parse(all["digests.json"]!),
  };
}

/** A fake GitHub repository serving the review files (optionally edited) at a fixed commit. */
export function reviewRepoTransportFixture(
  files: Record<string, string>,
  overrides: Partial<FakeRepoFixture> = {},
): FakeRepoFixture {
  return {
    owner: REVIEW_REPOSITORY.owner,
    name: REVIEW_REPOSITORY.name,
    repo: {
      name: REVIEW_REPOSITORY.name,
      full_name: `${REVIEW_REPOSITORY.owner}/${REVIEW_REPOSITORY.name}`,
      html_url: REVIEW_REPOSITORY.url,
      owner: { login: REVIEW_REPOSITORY.owner },
      default_branch: "main",
      private: false,
      archived: false,
      license: { spdx_id: "MIT" },
      id: 987654321,
    },
    commitSha: "4".repeat(40),
    treeSha: "5".repeat(40),
    files,
    ...overrides,
  };
}
