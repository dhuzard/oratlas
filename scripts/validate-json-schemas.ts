/**
 * Validate that the review-manifest JSON Schema is itself valid (draft 2020-12)
 * and that the reference example manifest validates against it. Run in CI.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(
  here,
  "..",
  "packages",
  "contracts",
  "schemas",
  "review-manifest.schema.json",
);

const exampleManifest = {
  schemaVersion: "1.0.0",
  review: {
    title: "Example review",
    abstract: "Example abstract",
    reviewType: "computational-literature-review",
    language: "en",
    keywords: ["example"],
    license: "CC-BY-4.0",
  },
  repository: {
    url: "https://github.com/owner/repository",
    commit: "0123456789abcdef0123456789abcdef01234567",
    releaseTag: "v1.0.0",
  },
  publication: {
    reviewUrl: "https://owner.github.io/repository/",
    versionDoi: "10.5281/zenodo.1234567",
    conceptDoi: "10.5281/zenodo.1234566",
    zenodoRecordId: "1234567",
  },
  contributors: [],
  artifacts: {
    claims: "knowledge/claims.jsonl",
    citations: "knowledge/citations.jsonl",
    relations: "knowledge/claim-evidence-relations.jsonl",
    trustAssessments: "knowledge/trust-assessments.jsonl",
    provenance: "provenance.json",
  },
};

function main(): void {
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const ok = validate(exampleManifest);
  if (!ok) {
    console.error("Example manifest failed schema validation:");
    console.error(validate.errors);
    process.exit(1);
  }

  // Negative check: an unsafe artifact path must be rejected.
  const bad = structuredClone(exampleManifest);
  bad.artifacts.claims = "../../etc/passwd";
  if (validate(bad)) {
    console.error("Schema incorrectly accepted an unsafe artifact path.");
    process.exit(1);
  }

  console.info("✓ review-manifest.schema.json is valid and matches the reference example.");
  console.info("✓ Unsafe artifact paths are rejected by the schema.");
}

main();
