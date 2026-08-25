import { NextResponse } from "next/server";
import { z } from "zod";
import { verifierStatusSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { setVerifierStatus } from "@/lib/scientific-verification";
import {
  handleVerificationRouteError,
  validateVerificationAdminMutation,
} from "@/lib/verification-api";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateVerificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    const input = z
      .object({ status: verifierStatusSchema })
      .strict()
      .parse(await readJsonBody(request));
    return NextResponse.json(await setVerifierStatus((await params).id, input.status, admin.id));
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
