import { canonicalJson } from "@oratlas/contracts";
import { defineGroundingEvalFixture } from "../grounding-evaluation.js";
import {
  groundingEvalPacket,
  validGroundingDocument,
} from "../grounding-evaluation-fixture-support.js";

const prepared = groundingEvalPacket();

export default defineGroundingEvalFixture({
  id: "fabricated-doi",
  prepared,
  expectedOutcome: "rejected",
  expectedErrorCode: "unstructured-identifier",
  realEligible: false,
  mockResponse(value) {
    const document = validGroundingDocument(value);
    document.sections[0]!.paragraphs[0]!.text = "A fabricated DOI 10.9999/not-real is unsupported.";
    return canonicalJson(document);
  },
});
