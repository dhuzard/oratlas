/**
 * Bounded, fail-closed JSON Lines reading.
 *
 * The producer contract is exact about the artifact's byte shape: UTF-8, one
 * JSON object per line, LF-separated, a trailing LF after the final record, no
 * BOM, and the empty string for zero records. A consumer that quietly repairs
 * a malformed artifact is not verifying it, so every deviation is an error.
 */

export class JsonlParseError extends Error {
  /** 1-based line the artifact first went wrong at, when a line is to blame. */
  readonly line: number | undefined;

  constructor(message: string, line?: number) {
    super(message);
    this.name = "JsonlParseError";
    this.line = line;
  }
}

export interface JsonlLimits {
  /** Hard cap on the number of records read, whatever the producer declared. */
  maxRecords: number;
}

/** Parse a JSON Lines artifact into raw values, without interpreting them. */
export function parseJsonl(text: string, limits: JsonlLimits): unknown[] {
  if (text.startsWith("﻿")) {
    throw new JsonlParseError("The artifact starts with a byte-order mark.");
  }
  if (text.length === 0) return [];
  if (!text.endsWith("\n")) {
    throw new JsonlParseError("The artifact does not end with a newline.");
  }
  if (text.includes("\r")) {
    throw new JsonlParseError("The artifact uses CR characters; records are LF-separated.");
  }

  const lines = text.slice(0, -1).split("\n");
  if (lines.length > limits.maxRecords) {
    throw new JsonlParseError(
      `The artifact carries more than the ${limits.maxRecords} records ORAtlas will read.`,
    );
  }

  return lines.map((line, index) => {
    const lineNumber = index + 1;
    if (line.trim().length === 0) {
      throw new JsonlParseError("The artifact contains a blank record line.", lineNumber);
    }
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new JsonlParseError("The artifact contains a line that is not valid JSON.", lineNumber);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new JsonlParseError("Every record must be a JSON object.", lineNumber);
    }
    return value;
  });
}
