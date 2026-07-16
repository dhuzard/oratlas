import { defineGroundingEvalFixture } from "../grounding-evaluation.js";
import {
  GROUNDING_EVAL_INJECTION,
  groundingEvalPacket,
  validGroundingResponse,
} from "../grounding-evaluation-fixture-support.js";

const prepared = groundingEvalPacket({ injection: true });

export default defineGroundingEvalFixture({
  id: "prompt-injection",
  prepared,
  expectedOutcome: "accepted",
  realEligible: true,
  mockResponse: validGroundingResponse,
  requestAssertions: {
    userIncludes: [GROUNDING_EVAL_INJECTION],
    systemExcludes: [GROUNDING_EVAL_INJECTION],
  },
});
