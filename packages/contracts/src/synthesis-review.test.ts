import { describe, expect, it } from "vitest";
import {
  synthesisReviewDocumentSchema,
  SYNTHESIS_REVIEW_SCHEMA_VERSION,
  SYNTHESIS_SECTION_IDS,
  SYNTHESIS_SECTION_TITLES,
  type SynthesisReviewDocument,
} from "./synthesis-review.js";

function document(): SynthesisReviewDocument {
  return synthesisReviewDocumentSchema.parse({
    schemaVersion: SYNTHESIS_REVIEW_SCHEMA_VERSION,
    title: "A bounded synthesis",
    summary: "A strict summary.",
    citations: [],
    sections: SYNTHESIS_SECTION_IDS.map((id, index) => ({
      id,
      title: SYNTHESIS_SECTION_TITLES[index],
      paragraphs: [{ text: `Plain section ${index + 1}.`, citations: [] }],
    })),
  });
}

describe("synthesis review contract", () => {
  it("accepts exactly the six ordered sections and strict citation ownership fields", () => {
    const value = document();
    value.sections[0]!.paragraphs[0]!.citations.push({
      referenceId: `reference:sha256:${"a".repeat(64)}`,
      nodeId: "node-a",
      nodeVersionId: "node-a-v1",
    });
    expect(
      synthesisReviewDocumentSchema.parse(value).sections.map((section) => section.id),
    ).toEqual(SYNTHESIS_SECTION_IDS);
  });

  it("rejects missing, reordered, renamed, and extra-key sections", () => {
    const missing = document();
    missing.sections.pop();
    expect(synthesisReviewDocumentSchema.safeParse(missing).success).toBe(false);

    const reordered = document();
    const mutableSections = reordered.sections as unknown as Array<unknown>;
    [mutableSections[0], mutableSections[1]] = [mutableSections[1], mutableSections[0]];
    expect(synthesisReviewDocumentSchema.safeParse(reordered).success).toBe(false);

    const renamed = document();
    (renamed.sections[0] as { title: string }).title = "Overview";
    expect(synthesisReviewDocumentSchema.safeParse(renamed).success).toBe(false);

    const extra = document() as SynthesisReviewDocument & { internal?: string };
    extra.internal = "not allowed";
    expect(synthesisReviewDocumentSchema.safeParse(extra).success).toBe(false);
  });

  it("rejects duplicate references, multiline/control prose, HTML, and URLs", () => {
    const duplicate = document();
    const citation = {
      referenceId: `reference:sha256:${"b".repeat(64)}`,
      nodeId: "node-b",
      nodeVersionId: "node-b-v1",
    };
    duplicate.sections[0]!.paragraphs[0]!.citations = [citation, citation];
    expect(synthesisReviewDocumentSchema.safeParse(duplicate).success).toBe(false);
    for (const text of [
      "two\nlines",
      "tab\tseparated",
      "<b>HTML</b>",
      "https://outside.invalid/item",
      "bad\u0000text",
    ]) {
      const invalid = document();
      invalid.sections[0]!.paragraphs[0]!.text = text;
      expect(synthesisReviewDocumentSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("enforces bounded paragraphs and total UTF-8 output", () => {
    const tooLong = document();
    tooLong.sections[0]!.paragraphs[0]!.text = "x".repeat(4_001);
    expect(synthesisReviewDocumentSchema.safeParse(tooLong).success).toBe(false);

    const tooMany = document();
    tooMany.sections[0]!.paragraphs = Array.from({ length: 13 }, () => ({
      text: "bounded",
      citations: [],
    }));
    expect(synthesisReviewDocumentSchema.safeParse(tooMany).success).toBe(false);

    const tooManyBytes = document();
    for (const section of tooManyBytes.sections) {
      section.paragraphs = Array.from({ length: 12 }, () => ({
        text: "é".repeat(1_000),
        citations: [],
      }));
    }
    expect(synthesisReviewDocumentSchema.safeParse(tooManyBytes).success).toBe(false);
  });
});
