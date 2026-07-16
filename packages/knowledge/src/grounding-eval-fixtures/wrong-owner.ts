import { canonicalJson } from "@oratlas/contracts";
import { defineGroundingEvalFixture } from "../grounding-evaluation.js";
import {
  groundingEvalPacket,
  validGroundingDocument,
} from "../grounding-evaluation-fixture-support.js";

const prepared = groundingEvalPacket();

export default defineGroundingEvalFixture({
  id: "wrong-owner",
  prepared,
  expectedOutcome: "rejected",
  expectedErrorCode: "reference-owner-mismatch",
  realEligible: false,
  mockResponse(value) {
    const document = validGroundingDocument(value);
    document.sections[0]!.paragraphs[0]!.citations[0]!.nodeId = "eval-dataset";
    return canonicalJson(document);
  },
});
