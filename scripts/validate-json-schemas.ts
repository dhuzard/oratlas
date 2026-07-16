/**
 * Validate public JSON Schemas (draft 2020-12) and their reference examples.
 * Run in CI so runtime contracts and machine-readable files cannot drift silently.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const manifestSchemaPath = join(
  here,
  "..",
  "packages",
  "contracts",
  "schemas",
  "review-manifest.schema.json",
);
const nodeManifestSchemaPath = join(
  here,
  "..",
  "packages",
  "contracts",
  "schemas",
  "node-manifest.schema.json",
);
const nodeManifestExamplePath = join(
  here,
  "..",
  "packages",
  "contracts",
  "schemas",
  "examples",
  "node-manifest.example.json",
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
  const schema = JSON.parse(readFileSync(manifestSchemaPath, "utf-8"));
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

  const nodeManifestSchema = JSON.parse(readFileSync(nodeManifestSchemaPath, "utf-8"));
  const exampleNodeManifest = JSON.parse(readFileSync(nodeManifestExamplePath, "utf-8"));
  const validateNodeManifest = ajv.compile(nodeManifestSchema);
  if (!validateNodeManifest(exampleNodeManifest)) {
    console.error("Reference node manifest failed schema validation:");
    console.error(validateNodeManifest.errors);
    process.exit(1);
  }

  const badNodeManifest = structuredClone(exampleNodeManifest);
  badNodeManifest.nodes.files[0] = "../../private.json";
  if (validateNodeManifest(badNodeManifest)) {
    console.error("Node manifest schema incorrectly accepted an unsafe node path.");
    process.exit(1);
  }
  console.info("✓ node-manifest.schema.json is valid and matches the reference example.");
  console.info("✓ Unsafe node source paths are rejected by the schema.");

  const atlasCheckSchema = JSON.parse(
    readFileSync(
      join(here, "..", "packages", "contracts", "schemas", "atlas-check-report.schema.json"),
      "utf-8",
    ),
  );
  const validateAtlasCheck = ajv.compile(atlasCheckSchema);
  const exampleReport = {
    schemaVersion: "1.0.0",
    tool: { name: "oratlas-check", version: "0.1.0" },
    summary: {
      passed: false,
      errors: 1,
      warnings: 0,
      notices: 0,
      filesChecked: 2,
      recordsChecked: 1,
    },
    findings: [
      {
        ruleId: "ORATLAS-ARTIFACT-002",
        severity: "error",
        message: "Invalid JSON in the claims artifact.",
        path: "knowledge/claims.jsonl",
        line: 2,
        suggestion: "Store exactly one JSON object per line.",
      },
    ],
  };
  if (!validateAtlasCheck(exampleReport)) {
    console.error("Example Atlas Check report failed schema validation:");
    console.error(validateAtlasCheck.errors);
    process.exit(1);
  }
  console.info("✓ atlas-check-report.schema.json is valid and matches the reference example.");
}

main();
