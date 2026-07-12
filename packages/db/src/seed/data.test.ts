import { describe, expect, it } from "vitest";
import { pendingSubmission, seedReviews } from "./data.js";

describe("seed snapshot identities", () => {
  it("uses full hexadecimal Git object ids", () => {
    const objectIds = [
      ...seedReviews.map((review) => review.snapshot.commitSha),
      pendingSubmission.snapshot.commitSha,
    ];
    for (const objectId of objectIds) {
      expect(objectId).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
    }
  });
});
