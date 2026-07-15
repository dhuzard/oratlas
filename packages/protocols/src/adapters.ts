import { z } from "zod";
import {
  normalizedProtocolSchema,
  PROTOCOL_SCHEMA_VERSION,
  type NormalizedProtocol,
  type ProtocolCategory,
  type ProtocolEvidence,
} from "./contracts.js";

const osfRegistrationSchema = z
  .object({
    data: z
      .object({
        id: z.string().min(1),
        attributes: z
          .object({
            title: z.string().min(1),
            date_registered: z.string().datetime().nullable().optional(),
            date_modified: z.string().datetime().nullable().optional(),
            registered_meta: z.record(z.string(), z.unknown()),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const outcomeSchema = z
  .object({
    measure: z.string().optional(),
    description: z.string().optional(),
    timeFrame: z.string().optional(),
  })
  .passthrough();

const clinicalTrialSchema = z
  .object({
    protocolSection: z
      .object({
        identificationModule: z
          .object({ nctId: z.string().regex(/^NCT\d{8}$/), briefTitle: z.string().min(1) })
          .passthrough(),
        statusModule: z
          .object({
            studyFirstPostDateStruct: z.object({ date: z.string() }).passthrough().optional(),
            lastUpdatePostDateStruct: z.object({ date: z.string() }).passthrough().optional(),
          })
          .passthrough()
          .optional(),
        eligibilityModule: z
          .object({
            eligibilityCriteria: z.string().optional(),
            healthyVolunteers: z.boolean().optional(),
            sex: z.string().optional(),
            minimumAge: z.string().optional(),
            maximumAge: z.string().optional(),
          })
          .passthrough()
          .optional(),
        outcomesModule: z
          .object({
            primaryOutcomes: z.array(outcomeSchema).optional(),
            secondaryOutcomes: z.array(outcomeSchema).optional(),
            otherOutcomes: z.array(outcomeSchema).optional(),
          })
          .passthrough()
          .optional(),
        designModule: z
          .object({
            studyType: z.string().optional(),
            phases: z.array(z.string()).optional(),
            designInfo: z.record(z.string(), z.unknown()).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export interface AdapterCapture {
  sourceUrl: string;
  sourceVersion: string;
  fetchedAt: string;
}

export interface OsfQuestion {
  id: string;
  label: string;
  category: ProtocolCategory | "unclassified";
}

/**
 * Normalize an OSF registration response. OSF registered_meta keys are schema
 * question ids, so callers must also supply the exact question labels fetched
 * from the related registration-schema endpoint. Missing labels fail closed:
 * opaque question ids are never guessed into scientific categories.
 */
export function adaptOsfRegistration(
  raw: unknown,
  questions: readonly OsfQuestion[],
  capture: AdapterCapture,
): NormalizedProtocol {
  const parsed = osfRegistrationSchema.parse(raw);
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const fields = emptyFields();
  const unclassified: ProtocolEvidence[] = [];
  for (const [questionId, response] of Object.entries(parsed.data.attributes.registered_meta)) {
    const values = flattenResponse(response);
    if (values.length === 0) continue;
    const question = questionMap.get(questionId);
    if (!question) {
      throw new Error(`OSF question metadata is missing for registered_meta id '${questionId}'.`);
    }
    const sourcePointer = `/data/attributes/registered_meta/${escapePointer(questionId)}`;
    for (const value of values) {
      if (question.category !== "unclassified") {
        fields[question.category].push({ value, sourcePointer });
      } else {
        unclassified.push({ value: `${question.label}: ${value}`, sourcePointer });
      }
    }
  }
  return normalizedProtocolSchema.parse({
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    source: {
      registry: "osf",
      sourceId: parsed.data.id,
      sourceUrl: capture.sourceUrl,
      sourceVersion: capture.sourceVersion,
      registeredAt: parsed.data.attributes.date_registered ?? undefined,
      lastUpdatedAt: parsed.data.attributes.date_modified ?? undefined,
      capturedAt: capture.fetchedAt,
    },
    title: parsed.data.attributes.title,
    fields: sortFields(fields),
    unclassified: sortEvidence(unclassified),
  });
}

/** Normalize one ClinicalTrials.gov API v2 study response without networking. */
export function adaptClinicalTrialsGovStudy(
  raw: unknown,
  capture: AdapterCapture,
): NormalizedProtocol {
  const parsed = clinicalTrialSchema.parse(raw);
  const section = parsed.protocolSection;
  const fields = emptyFields();
  const unclassified: ProtocolEvidence[] = [];
  const eligibility = section.eligibilityModule;
  if (eligibility) {
    const population = [
      eligibility.sex && `Sex: ${eligibility.sex}`,
      eligibility.minimumAge && `Minimum age: ${eligibility.minimumAge}`,
      eligibility.maximumAge && `Maximum age: ${eligibility.maximumAge}`,
      eligibility.healthyVolunteers !== undefined &&
        `Healthy volunteers: ${eligibility.healthyVolunteers ? "accepted" : "not accepted"}`,
    ].filter((value): value is string => Boolean(value));
    fields.population.push(
      ...population.map((value) => ({
        value,
        sourcePointer: "/protocolSection/eligibilityModule",
      })),
    );
    const criteria = eligibility.eligibilityCriteria;
    if (criteria) {
      const split = splitEligibility(criteria);
      if (split.inclusion) {
        fields.population.push({
          value: split.inclusion,
          sourcePointer: "/protocolSection/eligibilityModule/eligibilityCriteria#inclusion",
        });
      }
      if (split.exclusion) {
        fields.exclusions.push({
          value: split.exclusion,
          sourcePointer: "/protocolSection/eligibilityModule/eligibilityCriteria#exclusion",
        });
      }
    }
  }
  const outcomes = section.outcomesModule;
  for (const [key, rows] of [
    ["primaryOutcomes", outcomes?.primaryOutcomes],
    ["secondaryOutcomes", outcomes?.secondaryOutcomes],
    ["otherOutcomes", outcomes?.otherOutcomes],
  ] as const) {
    rows?.forEach((row, index) => {
      const value = [row.measure, row.description, row.timeFrame].filter(Boolean).join(" — ");
      if (value) {
        fields.outcomes.push({
          value,
          sourcePointer: `/protocolSection/outcomesModule/${key}/${index}`,
        });
      }
    });
  }
  const design = section.designModule;
  if (design) {
    if (design.studyType) {
      unclassified.push({
        value: `Study type: ${design.studyType}`,
        sourcePointer: "/protocolSection/designModule/studyType",
      });
    }
    design.phases?.forEach((phase, index) => {
      unclassified.push({
        value: `Phase: ${phase}`,
        sourcePointer: `/protocolSection/designModule/phases/${index}`,
      });
    });
    unclassified.push(
      ...flattenDesignEvidence(design.designInfo, "/protocolSection/designModule/designInfo", []),
    );
  }
  const status = section.statusModule;
  return normalizedProtocolSchema.parse({
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    source: {
      registry: "clinicaltrials-gov",
      sourceId: section.identificationModule.nctId,
      sourceUrl: capture.sourceUrl,
      sourceVersion: capture.sourceVersion,
      registeredAt: normalizeRegistryDate(status?.studyFirstPostDateStruct?.date),
      lastUpdatedAt: normalizeRegistryDate(status?.lastUpdatePostDateStruct?.date),
      capturedAt: capture.fetchedAt,
    },
    title: section.identificationModule.briefTitle,
    fields: sortFields(fields),
    unclassified: sortEvidence(unclassified),
  });
}

function emptyFields(): Record<ProtocolCategory, ProtocolEvidence[]> {
  return { population: [], outcomes: [], exclusions: [], "analysis-plan": [] };
}

function sortFields(
  fields: Record<ProtocolCategory, ProtocolEvidence[]>,
): Record<ProtocolCategory, ProtocolEvidence[]> {
  for (const values of Object.values(fields)) {
    values.sort((a, b) =>
      compareText(`${a.sourcePointer}\0${a.value}`, `${b.sourcePointer}\0${b.value}`),
    );
  }
  return fields;
}

function sortEvidence(values: ProtocolEvidence[]): ProtocolEvidence[] {
  return values.sort((a, b) =>
    compareText(`${a.sourcePointer}\0${a.value}`, `${b.sourcePointer}\0${b.value}`),
  );
}

/** Locale-independent UTF-16 ordering keeps normalized snapshots stable across runners. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function flattenResponse(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenResponse);
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    if ("value" in row) return flattenResponse(row.value);
    return Object.keys(row)
      .sort()
      .flatMap((key) => flattenResponse(row[key]));
  }
  return [];
}

function splitEligibility(text: string): { inclusion?: string; exclusion?: string } {
  const match = text.match(/(?:^|\n)\s*exclusion criteria\s*:?[ \t]*\n?/i);
  if (!match || match.index === undefined) return { inclusion: text.trim() || undefined };
  const inclusion = text
    .slice(0, match.index)
    .replace(/^\s*inclusion criteria\s*:?[ \t]*\n?/i, "")
    .trim();
  const exclusion = text.slice(match.index + match[0].length).trim();
  return { inclusion: inclusion || undefined, exclusion: exclusion || undefined };
}

function flattenDesignEvidence(
  value: unknown,
  pointer: string,
  labels: readonly string[],
): ProtocolEvidence[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    if (!text) return [];
    return [{ value: `${labels.map(humanize).join(" / ")}: ${text}`, sourcePointer: pointer }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      flattenDesignEvidence(entry, `${pointer}/${index}`, labels),
    );
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .flatMap(([key, entry]) =>
        flattenDesignEvidence(entry, `${pointer}/${escapePointer(key)}`, [...labels, key]),
      );
  }
  return [];
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}

function escapePointer(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function normalizeRegistryDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
