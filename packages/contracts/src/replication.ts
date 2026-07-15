import { z } from "zod";

export const replicationPublicUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .transform((value, context) => {
    const canonical = canonicalPublicHttpsUrl(value);
    if (canonical) return canonical;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Public links must use a public HTTPS destination without credentials, query, or fragment.",
    });
    return z.NEVER;
  });

export const REPLICATION_BRIEF_STATUSES = [
  "draft",
  "open",
  "claimed",
  "completed",
  "withdrawn",
] as const;
export const replicationBriefStatusSchema = z.enum(REPLICATION_BRIEF_STATUSES);
export type ReplicationBriefStatus = z.infer<typeof replicationBriefStatusSchema>;

export const REPLICATION_EFFORT_BANDS = ["small", "medium", "large", "consortium"] as const;
export const replicationEffortBandSchema = z.enum(REPLICATION_EFFORT_BANDS);
export type ReplicationEffortBand = z.infer<typeof replicationEffortBandSchema>;

export const REPLICATION_TRIAGE_BANDS = [
  "contradiction-attention",
  "independence-attention",
  "scope-attention",
  "routine-attention",
] as const;
export const replicationTriageBandSchema = z.enum(REPLICATION_TRIAGE_BANDS);
export type ReplicationTriageBand = z.infer<typeof replicationTriageBandSchema>;

export const replicationClaimRefSchema = z
  .object({
    reviewVersionId: z.string().trim().min(1).max(200),
    localClaimId: z.string().trim().min(1).max(120),
  })
  .strict();
export type ReplicationClaimRef = z.infer<typeof replicationClaimRefSchema>;

export const replicationScopeSchema = z
  .object({
    population: z.string().trim().min(1).max(300).optional(),
    model: z.string().trim().min(1).max(300).optional(),
    intervention: z.string().trim().min(1).max(300).optional(),
    outcome: z.string().trim().min(1).max(300).optional(),
    method: z.string().trim().min(1).max(300).optional(),
    notes: z.string().trim().min(20).max(2_000).optional(),
  })
  .strict()
  .refine((scope) => Object.values(scope).some(Boolean), {
    message:
      "At least one scoped population, model, intervention, outcome, method, or note is required.",
  });
export type ReplicationScope = z.infer<typeof replicationScopeSchema>;

const uniqueClaimRefs = (refs: ReplicationClaimRef[]) =>
  new Set(refs.map((ref) => `${ref.reviewVersionId}\u0000${ref.localClaimId}`)).size ===
  refs.length;
const uniqueUrls = (urls: string[]) => new Set(urls).size === urls.length;

/** Editor-authored draft. Publication remains a separate human-only transition. */
export const replicationBriefCreateSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    slug: z
      .string()
      .trim()
      .min(3)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(10).max(300),
    summary: z.string().trim().min(50).max(5_000),
    scope: replicationScopeSchema,
    expectedInformationGain: z.string().trim().min(50).max(5_000),
    effortBand: replicationEffortBandSchema,
    protocolUrl: replicationPublicUrlSchema.optional(),
    citationUrls: z.array(replicationPublicUrlSchema).min(1).max(20).refine(uniqueUrls, {
      message: "Citation links must be unique.",
    }),
    claims: z.array(replicationClaimRefSchema).min(1).max(20).refine(uniqueClaimRefs, {
      message: "Claim references must be unique.",
    }),
  })
  .strict();
export type ReplicationBriefCreate = z.infer<typeof replicationBriefCreateSchema>;

const expectedRevisionSchema = z.number().int().min(0).max(1_000_000_000);

export const replicationBriefTransitionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), expectedRevision: expectedRevisionSchema }).strict(),
  z
    .object({
      action: z.literal("claim"),
      expectedRevision: expectedRevisionSchema,
      protocolUrl: replicationPublicUrlSchema,
      note: z.string().trim().min(20).max(2_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete"),
      expectedRevision: expectedRevisionSchema,
      completionUrl: replicationPublicUrlSchema,
      summary: z.string().trim().min(50).max(5_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("withdraw"),
      expectedRevision: expectedRevisionSchema,
      reason: z.string().trim().min(20).max(5_000),
    })
    .strict(),
]);
export type ReplicationBriefTransition = z.infer<typeof replicationBriefTransitionSchema>;

export const replicationMarketplaceQuerySchema = z
  .object({
    status: z.enum(["open", "claimed", "completed", "withdrawn"]).optional(),
    effortBand: replicationEffortBandSchema.optional(),
    page: z.number().int().min(1).max(10_000).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ReplicationMarketplaceQuery = z.infer<typeof replicationMarketplaceQuerySchema>;

const INTERNAL_HOST_SUFFIXES = new Set([
  "corp",
  "example",
  "home",
  "home.arpa",
  "internal",
  "invalid",
  "intranet",
  "lan",
  "local",
  "localdomain",
  "localhost",
  "onion",
  "test",
]);

function canonicalPublicHttpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      value.includes("?") ||
      value.includes("#")
    ) {
      return undefined;
    }
    const parsedHostname = url.hostname.toLowerCase();
    const hostname = parsedHostname.startsWith("[")
      ? parsedHostname
      : parsedHostname.replace(/\.+$/, "");
    if (!hostname || !isPublicHostname(hostname)) return undefined;
    if (!hostname.startsWith("[")) url.hostname = hostname;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isPublicHostname(hostname: string): boolean {
  const ipv6 = parseIpv6(hostname);
  if (ipv6) return isPublicIpv6(ipv6);
  const ipv4 = parseIpv4(hostname);
  if (ipv4) return isPublicIpv4(ipv4);
  if (/^[\d.]+$/.test(hostname)) return false;

  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((label) => !isDnsLabel(label))) return false;
  const suffixes = labels.map((_, index) => labels.slice(index).join("."));
  if (suffixes.some((suffix) => INTERNAL_HOST_SUFFIXES.has(suffix))) return false;
  const topLevel = labels.at(-1)!;
  return topLevel.length >= 2 && !/^\d+$/.test(topLevel);
}

function isDnsLabel(label: string): boolean {
  return label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
}

function parseIpv4(hostname: string): [number, number, number, number] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined;
  const values = parts.map(Number);
  if (values.some((part) => part > 255)) return undefined;
  return values as [number, number, number, number];
}

function isPublicIpv4([a, b, c]: [number, number, number, number]): boolean {
  return !(
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv6(hostname: string): number[] | undefined {
  if (!hostname.startsWith("[") || !hostname.endsWith("]")) return undefined;
  let address = hostname.slice(1, -1);
  if (address.includes("%")) return undefined;
  if (address.includes(".")) {
    const separator = address.lastIndexOf(":");
    const ipv4 = parseIpv4(address.slice(separator + 1));
    if (separator < 0 || !ipv4) return undefined;
    address = `${address.slice(0, separator)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${(
      (ipv4[2] << 8) |
      ipv4[3]
    ).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const parseHalf = (half: string) =>
    half
      ? half.split(":").map((part) => (/^[a-f0-9]{1,4}$/i.test(part) ? parseInt(part, 16) : -1))
      : [];
  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  if (left.includes(-1) || right.includes(-1)) return undefined;
  if (halves.length === 1) return left.length === 8 ? left : undefined;
  const omitted = 8 - left.length - right.length;
  return omitted >= 1 ? [...left, ...Array<number>(omitted).fill(0), ...right] : undefined;
}

function isPublicIpv6(parts: number[]): boolean {
  const [first, second] = parts;
  if (first === undefined || second === undefined) return false;
  // Only currently allocated global-unicast space is accepted. Explicitly
  // exclude IETF special-purpose, documentation, 6to4, and 3fff::/20 blocks.
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false;
  if (first === 0x2002 || first === 0x3fff) return false;
  return true;
}
