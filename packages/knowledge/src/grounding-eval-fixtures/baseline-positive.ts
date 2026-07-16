import { defineGroundingEvalFixture } from "../grounding-evaluation.js";
import {
  groundingEvalPacket,
  validGroundingResponse,
} from "../grounding-evaluation-fixture-support.js";

const prepared = groundingEvalPacket();

export default defineGroundingEvalFixture({
  id: "baseline-positive",
  prepared,
  expectedOutcome: "accepted",
  realEligible: true,
  mockResponse: validGroundingResponse,
});
