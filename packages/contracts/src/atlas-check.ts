import { z } from "zod";
import { safeRepoRelativePathSchema } from "./paths.js";

/** Stable, machine-readable contract emitted by the deterministic Atlas Check evaluator. */
export const ATLAS_CHECK_SCHEMA_VERSION = "1.0.0";
export const ATLAS_CHECK_TOOL_VERSION = "0.1.0";

export const atlasCheckSeveritySchema = z.enum(["error", "warning", "notice"]);
export type AtlasCheckSeverity = z.infer<typeof atlasCheckSeveritySchema>;

export const atlasCheckFindingSchema = z
  .object({
    ruleId: z.string().regex(/^ORATLAS-[A-Z]+-\d{3}$/),
    severity: atlasCheckSeveritySchema,
    message: z.string().min(1).max(4_000),
    path: safeRepoRelativePathSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    suggestion: z.string().min(1).max(4_000).optional(),
  })
  .strict();
export type AtlasCheckFinding = z.infer<typeof atlasCheckFindingSchema>;

export const atlasCheckReportSchema = z
  .object({
    schemaVersion: z.literal(ATLAS_CHECK_SCHEMA_VERSION),
    tool: z
      .object({ name: z.literal("oratlas-check"), version: z.string().min(1).max(40) })
      .strict(),
    summary: z
      .object({
        passed: z.boolean(),
        errors: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        notices: z.number().int().nonnegative(),
        filesChecked: z.number().int().nonnegative(),
        recordsChecked: z.number().int().nonnegative(),
      })
      .strict(),
    findings: z.array(atlasCheckFindingSchema).max(1_000),
  })
  .strict();
export type AtlasCheckReport = z.infer<typeof atlasCheckReportSchema>;
