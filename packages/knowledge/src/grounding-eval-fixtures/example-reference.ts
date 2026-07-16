import { canonicalJson } from "@oratlas/contracts";
import { defineGroundingEvalFixture } from "../grounding-evaluation.js";
import {
  citationFor,
  groundingEvalPacket,
  referenceFor,
  validGroundingDocument,
} from "../grounding-evaluation-fixture-support.js";

const prepared = groundingEvalPacket();

export default defineGroundingEvalFixture({
  id: "example-reference",
  prepared,
  expectedOutcome: "rejected",
  expectedErrorCode: "example-reference",
  realEligible: false,
  mockResponse(value) {
    const document = validGroundingDocument(value);
    const example = referenceFor(
      value,
      (reference) => reference.kind === "node" && reference.nodeId === "eval-example",
    );
    document.sections[0]!.paragraphs[0]!.citations = [citationFor(example)];
    return canonicalJson(document);
  },
});
