import { z } from "zod";

/**
 * Deliberately bounded set of SPDX identifiers accepted for synthesis publication.
 * Extend this list only with identifiers from the SPDX License List.
 */
export const SYNTHESIS_SUPPORTED_SPDX_LICENSE_IDS = [
  "0BSD",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC-BY-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-ND-4.0",
  "CC-BY-NC-SA-4.0",
  "CC-BY-ND-4.0",
  "CC-BY-SA-4.0",
  "CC0-1.0",
  "CDLA-Permissive-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MPL-2.0",
  "ODbL-1.0",
  "PDDL-1.0",
  "Unlicense",
] as const;

export const SYNTHESIS_SUPPORTED_SPDX_EXCEPTION_IDS = [
  "Autoconf-exception-3.0",
  "Bison-exception-2.2",
  "Classpath-exception-2.0",
  "GCC-exception-3.1",
  "LLVM-exception",
] as const;

const licenseIds = new Set<string>(SYNTHESIS_SUPPORTED_SPDX_LICENSE_IDS);
const exceptionIds = new Set<string>(SYNTHESIS_SUPPORTED_SPDX_EXCEPTION_IDS);
const operators = new Set(["AND", "OR", "WITH"]);

function tokenizeSpdxExpression(value: string): string[] | null {
  const tokens: string[] = [];
  for (let index = 0; index < value.length;) {
    const character = value[index]!;
    if (character === " " || character === "\t" || character === "\r" || character === "\n") {
      index += 1;
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push(character);
      index += 1;
      continue;
    }
    const start = index;
    while (index < value.length) {
      const code = value.charCodeAt(index);
      const allowed =
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 45 ||
        code === 46;
      if (!allowed) break;
      index += 1;
    }
    if (start === index) return null;
    tokens.push(value.slice(start, index));
    if (tokens.length > 64) return null;
  }
  return tokens;
}

/** Bounded recursive-descent parser for the SPDX AND/OR/WITH expression subset we publish. */
export function isSupportedSynthesisSpdxExpression(value: string): boolean {
  if (value.length < 1 || value.length > 120) return false;
  const tokens = tokenizeSpdxExpression(value);
  if (!tokens?.length) return false;
  let cursor = 0;

  const parseLicense = (): boolean => {
    const identifier = tokens[cursor];
    if (!identifier || operators.has(identifier) || !licenseIds.has(identifier)) return false;
    cursor += 1;
    if (tokens[cursor] === "WITH") {
      cursor += 1;
      const exception = tokens[cursor];
      if (!exception || !exceptionIds.has(exception)) return false;
      cursor += 1;
    }
    return true;
  };
  const parsePrimary = (): boolean => {
    if (tokens[cursor] !== "(") return parseLicense();
    cursor += 1;
    if (!parseOr() || tokens[cursor] !== ")") return false;
    cursor += 1;
    return true;
  };
  const parseAnd = (): boolean => {
    if (!parsePrimary()) return false;
    while (tokens[cursor] === "AND") {
      cursor += 1;
      if (!parsePrimary()) return false;
    }
    return true;
  };
  const parseOr = (): boolean => {
    if (!parseAnd()) return false;
    while (tokens[cursor] === "OR") {
      cursor += 1;
      if (!parseAnd()) return false;
    }
    return true;
  };

  return parseOr() && cursor === tokens.length;
}

export const synthesisSpdxExpressionSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(isSupportedSynthesisSpdxExpression, {
    message: "Must be a supported SPDX license expression.",
  });
