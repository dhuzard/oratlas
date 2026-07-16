import { canonicalJson } from "@oratlas/contracts";
import { defineGroundingEvalFixture } from "../grounding-evaluation.js";
import {
  groundingEvalPacket,
  validGroundingDocument,
} from "../grounding-evaluation-fixture-support.js";

const prepared = groundingEvalPacket();

export default defineGroundingEvalFixture({
  id: "reserved-example-doi",
  prepared,
  expectedOutcome: "rejected",
  expectedErrorCode: "reserved-example-identifier",
  realEligible: false,
  mockResponse(value) {
    const document = validGroundingDocument(value);
    document.sections[0]!.paragraphs[0]!.text = "Reserved DOI 10.5555/example must never leak.";
    return canonicalJson(document);
  },
});
