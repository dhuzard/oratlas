export {
  normalizeDoi,
  isZenodoDoi,
  isExampleDoi,
  zenodoRecordIdFromDoi,
  type DoiNormalizeResult,
} from "./normalize.js";
export {
  createFetchResolver,
  parseZenodoRecord,
  type DoiResolver,
  type DoiResolution,
  type ZenodoRecord,
  type FetchResolverOptions,
} from "./client.js";
export { validateDoi, type ValidateDoiInput, type ValidateDoiOptions } from "./validate.js";
