import { canonicalJson } from "@oratlas/contracts";
import { defineGroundingEvalFixture } from "../grounding-evaluation.js";
import {
  groundingEvalPacket,
  validGroundingDocument,
} from "../grounding-evaluation-fixture-support.js";

const prepared = groundingEvalPacket();

export default defineGroundingEvalFixture({
  id: "wrong-version",
  prepared,
  expectedOutcome: "rejected",
  expectedErrorCode: "reference-version-mismatch",
  realEligible: false,
  mockResponse(value) {
    const document = validGroundingDocument(value);
    document.sections[0]!.paragraphs[0]!.citations[0]!.nodeVersionId = "eval-claim-v2";
    return canonicalJson(document);
  },
});
