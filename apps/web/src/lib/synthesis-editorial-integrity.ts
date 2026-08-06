import { createHash } from "node:crypto";
import {
  canonicalJson,
  type SynthesisReviewCitation,
  type SynthesisReviewDocument,
  type SynthesisSelector,
} from "@oratlas/contracts";

export function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function synthesisSeriesKey(selector: SynthesisSelector): string {
  return digest(canonicalJson(selector.selection));
}

export function citationOccurrences(document: SynthesisReviewDocument) {
  const occurrences: Array<{
    location: string;
    sectionId?: string;
    paragraphIndex?: number;
    citationIndex: number;
    citation: SynthesisReviewCitation;
  }> = document.citations.map((citation, citationIndex) => ({
    location: "document",
    citationIndex,
    citation,
  }));
  for (const section of document.sections) {
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      paragraph.citations.forEach((citation, citationIndex) => {
        occurrences.push({
          location: `sections.${section.id}.paragraphs.${paragraphIndex}`,
          sectionId: section.id,
          paragraphIndex,
          citationIndex,
          citation,
        });
      });
    });
  }
  return occurrences;
}
