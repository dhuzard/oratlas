import { z } from "zod";

/** Authoring toolchains ORAtlas implements an adapter for. Closed on purpose. */
export const PUBLICATION_ADAPTER_TYPES = ["myst"] as const;
export const publicationAdapterTypeSchema = z.enum(PUBLICATION_ADAPTER_TYPES);
export type PublicationAdapterType = z.infer<typeof publicationAdapterTypeSchema>;
