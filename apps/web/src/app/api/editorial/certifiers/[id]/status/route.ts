import { NextResponse } from "next/server";
import { certifierStatusSchema } from "@oratlas/contracts";
import { z } from "zod";
import { readJsonBody } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { setCertifierStatus } from "@/lib/certification";
import {
  handleCertificationRouteError,
  validateCertificationAdminMutation,
} from "@/lib/certification-api";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateCertificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    const input = z
      .object({ status: certifierStatusSchema })
      .strict()
      .parse(await readJsonBody(request));
    return NextResponse.json(await setCertifierStatus((await params).id, input.status, admin.id));
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
