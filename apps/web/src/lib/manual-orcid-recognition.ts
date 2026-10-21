import { z } from "zod";
import { isChecksumValidOrcid } from "@oratlas/contracts";

/** Profile-input validation only; bibliographic/source schemas stay unchanged. */
export const manualOrcidSchema = z.string().refine(isChecksumValidOrcid, {
  message: "ORCID iD format or checksum invalid.",
});

const lookupResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("found"), orcid: manualOrcidSchema }).strict(),
  z.object({ status: z.literal("not-found") }).strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
]);

export type ManualOrcidRecognition =
  | { status: "invalid" }
  | { status: "recognized"; orcid: string; ownership: "unverified" }
  | { status: "not-found" }
  | { status: "inconclusive" };

/**
 * An injected public-record lookup, not an identifier-control verifier. A future
 * adapter owns bounded network timeouts and maps outages to unavailable. No
 * concrete provider, transport, credentials or persistence is wired here.
 */
export type ManualOrcidLookup = (orcid: string) => Promise<unknown>;

export async function recognizeManualOrcid(
  input: unknown,
  lookup: ManualOrcidLookup,
): Promise<ManualOrcidRecognition> {
  const parsed = manualOrcidSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  try {
    const result = lookupResultSchema.safeParse(await lookup(parsed.data));
    if (!result.success || result.data.status === "unavailable") {
      return { status: "inconclusive" };
    }
    if (result.data.status === "not-found") return { status: "not-found" };
    if (result.data.orcid !== parsed.data) return { status: "inconclusive" };
    return { status: "recognized", orcid: parsed.data, ownership: "unverified" };
  } catch {
    return { status: "inconclusive" };
  }
}
