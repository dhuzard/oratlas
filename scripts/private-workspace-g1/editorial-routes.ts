/**
 * Declarative loader inventory only. The capture spec owns literal handler imports so ordinary
 * scripts remain independent from application internals; this file executes no application code.
 */
export const EDITORIAL_ROUTE_MODULES = {
  "api/certifiers": "@/app/api/certifiers/route",
  "api/certifiers/[id]": "@/app/api/certifiers/[id]/route",
  "api/verifiers": "@/app/api/verifiers/route",
  "api/verifiers/[id]": "@/app/api/verifiers/[id]/route",
  "api/certification-protocols": "@/app/api/certification-protocols/route",
  "api/certification-protocols/[id]": "@/app/api/certification-protocols/[id]/route",
  "api/verification-protocols": "@/app/api/verification-protocols/route",
  "api/verification-protocols/[id]": "@/app/api/verification-protocols/[id]/route",
  "api/editorial/verifiers/[id]/status": "@/app/api/editorial/verifiers/[id]/status/route",
  "api/editorial/verification-protocols/[id]/retire":
    "@/app/api/editorial/verification-protocols/[id]/retire/route",
  "api/editorial/certification-protocols/[id]/retire":
    "@/app/api/editorial/certification-protocols/[id]/retire/route",
} as const;
