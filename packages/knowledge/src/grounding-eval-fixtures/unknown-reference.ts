import { canonicalJson } from "@oratlas/contracts";
import { defineGroundingEvalFixture } from "../grounding-evaluation.js";
import {
  groundingEvalPacket,
  validGroundingDocument,
} from "../grounding-evaluation-fixture-support.js";

const prepared = groundingEvalPacket();

export default defineGroundingEvalFixture({
  id: "unknown-reference",
  prepared,
  expectedOutcome: "rejected",
  expectedErrorCode: "unknown-reference",
  realEligible: false,
  mockResponse(value) {
    const document = validGroundingDocument(value);
    document.sections[0]!.paragraphs[0]!.citations[0]!.referenceId = `reference:sha256:${"f".repeat(64)}`;
    return canonicalJson(document);
  },
});
