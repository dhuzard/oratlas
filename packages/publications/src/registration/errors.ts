import { type PublicationRegistrationErrorCode } from "@oratlas/contracts";

/**
 * A fail-closed registration refusal.
 *
 * The message is written to be safe to return to a caller: it names what about
 * the *publication* was unacceptable and never what ORAtlas's network, DNS or
 * infrastructure looks like. `detail` carries the operator-facing specifics
 * (which claim, which path) and is likewise free of internal state.
 */
export class PublicationRegistrationError extends Error {
  readonly code: PublicationRegistrationErrorCode;
  readonly detail: string | undefined;

  constructor(code: PublicationRegistrationErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "PublicationRegistrationError";
    this.code = code;
    this.detail = detail;
  }
}
