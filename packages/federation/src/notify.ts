import { z } from "zod";

export const ACTIVITY_STREAMS_CONTEXT = "https://www.w3.org/ns/activitystreams";
export const COAR_NOTIFY_CONTEXT = "https://coar-notify.net";
const LEGACY_COAR_NOTIFY_CONTEXT = "https://purl.org/coar/notify";

const MAX_URI_LENGTH = 2_048;

function isUri(value: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const uriSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_URI_LENGTH)
  .refine((value) => isUri(value, ["https:", "http:", "urn:"]), "Must be an HTTP(S) or URN URI.");

const httpUriSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_URI_LENGTH)
  .refine((value) => isUri(value, ["https:", "http:"]), "Must be an HTTP(S) URI.");

const typeSchema = z.union([
  z.string().trim().min(1).max(120),
  z.array(z.string().trim().min(1).max(120)).min(1).max(12),
]);

const ACTIVITY_STREAMS_OBJECT_TYPES = new Set([
  "Object",
  "Article",
  "Audio",
  "Document",
  "Event",
  "Image",
  "Note",
  "Page",
  "Place",
  "Profile",
  "Relationship",
  "Tombstone",
  "Video",
]);

/**
 * COAR Notify permits additional vocabulary, but remote contexts are mutable
 * executable inputs to JSON-LD expansion. Atlas therefore pins the two
 * protocol contexts in deterministic order and retains extensions expressed
 * with supported terms from those contexts or absolute-IRI property names.
 */
const contextsSchema = z.tuple([
  z.literal(ACTIVITY_STREAMS_CONTEXT),
  z.union([z.literal(COAR_NOTIFY_CONTEXT), z.literal(LEGACY_COAR_NOTIFY_CONTEXT)]),
]);

const SUPPORTED_JSON_LD_PROPERTIES = new Set([
  "actor",
  "context",
  "id",
  "inReplyTo",
  "inbox",
  "ietf:cite-as",
  "ietf:item",
  "mediaType",
  "name",
  "object",
  "origin",
  "summary",
  "target",
  "type",
]);
const MAX_JSON_LD_DEPTH = 64;
const MAX_JSON_LD_NODES = 10_000;

function isAbsoluteIriPropertyName(value: string): boolean {
  try {
    return new URL(value).protocol.length > 1;
  } catch {
    return false;
  }
}

function propertyError(path: (string | number)[], message: string): never {
  throw new z.ZodError([{ code: z.ZodIssueCode.custom, path, message }]);
}

interface JsonLdTraversalState {
  ancestors: Set<object>;
  nodes: number;
}

function visitJsonLdValue(
  value: unknown,
  path: (string | number)[],
  root: boolean,
  depth: number,
  state: JsonLdTraversalState,
): void {
  if (depth > MAX_JSON_LD_DEPTH) {
    propertyError(path, `JSON-LD payload exceeds the maximum depth of ${MAX_JSON_LD_DEPTH}.`);
  }
  state.nodes += 1;
  if (state.nodes > MAX_JSON_LD_NODES) {
    propertyError(path, `JSON-LD payload exceeds the maximum node count of ${MAX_JSON_LD_NODES}.`);
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      propertyError(path, "Non-finite JSON-LD numbers are not accepted.");
    return;
  }
  if (typeof value !== "object") {
    propertyError(path, "JSON-LD values must contain only JSON-safe data.");
  }

  if (state.ancestors.has(value)) {
    propertyError(path, "Circular JSON-LD values are not accepted.");
  }
  state.ancestors.add(value);
  if (Array.isArray(value)) {
    try {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          propertyError([...path, index], "Sparse JSON-LD arrays are not accepted.");
        }
        visitJsonLdValue(value[index], [...path, index], false, depth + 1, state);
      }
    } finally {
      state.ancestors.delete(value);
    }
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    state.ancestors.delete(value);
    propertyError(path, "JSON-LD values must use plain objects.");
  }

  try {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") {
        propertyError(path, "Symbol properties are not accepted in JSON-LD objects.");
      }
      const propertyPath = [...path, key];
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        propertyError(propertyPath, "JSON-LD object properties must be enumerable data values.");
      }
      if (key === "@context") {
        if (!root) {
          propertyError(
            propertyPath,
            "Nested JSON-LD contexts are not accepted by the pinned profile.",
          );
        }
      } else if (key.startsWith("@")) {
        propertyError(
          propertyPath,
          `JSON-LD keyword ${key} is not accepted by the pinned profile.`,
        );
      } else if (!SUPPORTED_JSON_LD_PROPERTIES.has(key) && !isAbsoluteIriPropertyName(key)) {
        propertyError(
          propertyPath,
          `Unknown bare JSON-LD property ${key}; extensions must use absolute-IRI property names.`,
        );
      }
      visitJsonLdValue(descriptor.value, propertyPath, false, depth + 1, state);
    }
  } finally {
    state.ancestors.delete(value);
  }
}

function validateJsonLdProperties(value: unknown): void {
  try {
    visitJsonLdValue(value, [], true, 0, { ancestors: new Set<object>(), nodes: 0 });
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    propertyError([], "JSON-LD value could not be inspected safely.");
  }
}

const actorSchema = z
  .object({
    id: uriSchema,
    type: z.enum(["Application", "Group", "Organization", "Person", "Service"]),
    name: z.string().trim().min(1).max(300).optional(),
  })
  .passthrough();

const serviceSchema = z
  .object({
    id: httpUriSchema,
    type: typeSchema,
    inbox: httpUriSchema.optional(),
  })
  .passthrough();

const targetServiceSchema = serviceSchema.extend({ inbox: httpUriSchema }).passthrough();

function includesActivityStreamsObjectType(value: string | string[]): boolean {
  return (Array.isArray(value) ? value : [value]).some((type) =>
    ACTIVITY_STREAMS_OBJECT_TYPES.has(type),
  );
}

const contentItemSchema = z
  .object({
    id: httpUriSchema,
    type: typeSchema,
    mediaType: z.string().trim().min(1).max(200),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (!includesActivityStreamsObjectType(value.type)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: "Content item type must include an ActivityStreams object type.",
      });
    }
  });

const scholarlyResourceSchema = z
  .object({
    id: httpUriSchema,
    type: typeSchema,
    "ietf:cite-as": httpUriSchema.optional(),
    "ietf:item": contentItemSchema.optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (!includesActivityStreamsObjectType(value.type)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: "Scholarly resource type must include an ActivityStreams object type.",
      });
    }
  });

const reviewedContextSchema = z
  .object({
    id: httpUriSchema,
    type: typeSchema.optional(),
    "ietf:cite-as": httpUriSchema.optional(),
    "ietf:item": contentItemSchema.optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (value.type && !includesActivityStreamsObjectType(value.type)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: "Context type must include an ActivityStreams object type.",
      });
    }
  });

function includesType(value: string | string[], required: string): boolean {
  return Array.isArray(value) ? value.includes(required) : value === required;
}

function requireTypes(
  value: { type: string | string[] },
  context: z.RefinementCtx,
  required: string[],
): void {
  for (const type of required) {
    if (!includesType(value.type, type)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: `Activity type must include ${type}.`,
      });
    }
  }
}

const baseActivitySchema = z
  .object({
    "@context": contextsSchema,
    id: uriSchema,
    actor: actorSchema.optional(),
    origin: serviceSchema,
    target: targetServiceSchema,
    type: typeSchema,
    inReplyTo: uriSchema.optional(),
    summary: z.string().trim().min(1).max(4_000).optional(),
  })
  .passthrough();

export const requestReviewSchema = baseActivitySchema
  .extend({
    object: scholarlyResourceSchema.and(z.object({ "ietf:item": contentItemSchema }).passthrough()),
  })
  .passthrough()
  .superRefine((value, context) =>
    requireTypes(value, context, ["Offer", "coar-notify:ReviewAction"]),
  );
export type RequestReviewActivity = z.infer<typeof requestReviewSchema>;

export const announceReviewSchema = baseActivitySchema
  .extend({
    context: reviewedContextSchema,
    object: scholarlyResourceSchema,
  })
  .passthrough()
  .superRefine((value, context) =>
    requireTypes(value, context, ["Announce", "coar-notify:ReviewAction"]),
  );
export type AnnounceReviewActivity = z.infer<typeof announceReviewSchema>;

export const federationResolutionSchema = z
  .object({
    decision: z.enum(["accepted", "rejected"]),
    note: z.string().trim().min(10).max(4_000),
  })
  .strict();
export type FederationResolution = z.infer<typeof federationResolutionSchema>;

export interface NormalizedCoarNotifyActivity {
  pattern: "request-review" | "announce-review";
  activityId: string;
  actorId?: string;
  objectId: string;
  contextId?: string;
  originId: string;
  originInbox?: string;
  targetId: string;
  targetInbox: string;
  inReplyTo?: string;
  payload: RequestReviewActivity | AnnounceReviewActivity;
}

/** Validate only the two review patterns ORAtlas supports; unknown activities fail closed. */
export function parseCoarNotifyActivity(input: unknown): NormalizedCoarNotifyActivity {
  validateJsonLdProperties(input);
  const record = input && typeof input === "object" ? (input as { type?: unknown }) : {};
  const types = Array.isArray(record.type) ? record.type : [record.type];
  if (types.includes("Offer")) {
    const payload = requestReviewSchema.parse(input);
    return {
      pattern: "request-review",
      activityId: payload.id,
      actorId: payload.actor?.id,
      objectId: payload.object.id,
      originId: payload.origin.id,
      originInbox: payload.origin.inbox,
      targetId: payload.target.id,
      targetInbox: payload.target.inbox,
      inReplyTo: payload.inReplyTo,
      payload,
    };
  }
  if (types.includes("Announce")) {
    const payload = announceReviewSchema.parse(input);
    return {
      pattern: "announce-review",
      activityId: payload.id,
      actorId: payload.actor?.id,
      objectId: payload.object.id,
      contextId: payload.context.id,
      originId: payload.origin.id,
      originInbox: payload.origin.inbox,
      targetId: payload.target.id,
      targetInbox: payload.target.inbox,
      inReplyTo: payload.inReplyTo,
      payload,
    };
  }
  throw new z.ZodError([
    {
      code: z.ZodIssueCode.custom,
      path: ["type"],
      message: "Unsupported COAR Notify review pattern.",
    },
  ]);
}

export interface BuildAnnounceReviewInput {
  activityId: string;
  actor: { id: string; name: string };
  review: {
    id: string;
    citeAs?: string;
    item?: { id: string; type: string | string[]; mediaType: string };
    exports?: Array<{ id: string; type: string | string[]; mediaType: string }>;
  };
  reviewedResource: {
    id: string;
    citeAs?: string;
    type?: string | string[];
    item?: { id: string; type: string | string[]; mediaType: string };
  };
  origin: { id: string; inbox?: string };
  target: { id: string; inbox: string };
  inReplyTo?: string;
}

/** Build a COAR Notify 1.0.1 Announce Review payload from immutable archive URLs. */
export function buildAnnounceReview(input: BuildAnnounceReviewInput): AnnounceReviewActivity {
  return announceReviewSchema.parse({
    "@context": [ACTIVITY_STREAMS_CONTEXT, COAR_NOTIFY_CONTEXT],
    actor: { id: input.actor.id, name: input.actor.name, type: "Service" },
    context: {
      id: input.reviewedResource.id,
      ...(input.reviewedResource.citeAs ? { "ietf:cite-as": input.reviewedResource.citeAs } : {}),
      ...(input.reviewedResource.type ? { type: input.reviewedResource.type } : {}),
      ...(input.reviewedResource.item ? { "ietf:item": input.reviewedResource.item } : {}),
    },
    id: input.activityId,
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    object: {
      id: input.review.id,
      type: ["Page", "sorg:Review"],
      ...(input.review.citeAs ? { "ietf:cite-as": input.review.citeAs } : {}),
      ...(input.review.item ? { "ietf:item": input.review.item } : {}),
      ...(input.review.exports ? { "https://oratlas.org/ns/exports": input.review.exports } : {}),
    },
    origin: {
      id: input.origin.id,
      type: "Service",
      ...(input.origin.inbox ? { inbox: input.origin.inbox } : {}),
    },
    target: { id: input.target.id, inbox: input.target.inbox, type: "Service" },
    type: ["Announce", "coar-notify:ReviewAction"],
  });
}
