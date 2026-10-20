/**
 * Single-use effect permits for the local synthetic effect-ordering fixture
 * (docs/local-synthetic-alpha-ordering.md).
 *
 * A permit is an empty frozen object whose meaning lives only in a private `WeakMap` of the
 * authority that minted it, so it cannot be forged from data, copied, or replayed: any presentation
 * of a known permit consumes it, and the binding (domain, generation, operation, kind) must match
 * the owner's expectation at the effect boundary. The harness mints and consumes a permit in the
 * same synchronous step at the boundary and never hands one out.
 *
 * An authority on its own controls no effect; tests construct standalone authorities to falsify
 * forgery, replay and mismatch handling without obtaining any harness capability.
 */

export type PermitKind = "http-release" | "http-denial" | "provider-start" | "revoke-commit";

export interface PermitBinding {
  readonly domain: string;
  readonly generation: number;
  readonly operationId: string;
  readonly kind: PermitKind;
}

/** Opaque token. Its shape carries no authority; only the minting authority can interpret it. */
export type Permit = { readonly __syntheticPermit?: never };

export type PermitVerdict =
  | "accepted"
  | "forged"
  | "replayed"
  | "wrong-domain"
  | "wrong-generation"
  | "wrong-operation"
  | "wrong-kind";

interface PermitRecord {
  readonly binding: PermitBinding;
  used: boolean;
}

export class PermitAuthority {
  readonly #records = new WeakMap<object, PermitRecord>();

  mint(binding: PermitBinding): Permit {
    const permit: Permit = Object.freeze(Object.create(null) as object);
    this.#records.set(permit, { binding: Object.freeze({ ...binding }), used: false });
    return permit;
  }

  /**
   * Consume `candidate` against `expected`. Single use: a known permit is spent by its first
   * presentation whatever the verdict, so a mismatched presentation cannot be retried.
   */
  consume(candidate: unknown, expected: PermitBinding): PermitVerdict {
    if (typeof candidate !== "object" || candidate === null) return "forged";
    const record = this.#records.get(candidate);
    if (!record) return "forged";
    if (record.used) return "replayed";
    record.used = true;
    const { binding } = record;
    if (binding.domain !== expected.domain) return "wrong-domain";
    if (binding.operationId !== expected.operationId) return "wrong-operation";
    if (binding.kind !== expected.kind) return "wrong-kind";
    if (binding.generation !== expected.generation) return "wrong-generation";
    return "accepted";
  }
}
