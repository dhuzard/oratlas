import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { retireVerificationProtocol } from "@/lib/scientific-verification";
import {
  handleVerificationRouteError,
  validateVerificationAdminMutation,
} from "@/lib/verification-api";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateVerificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    return NextResponse.json(await retireVerificationProtocol((await params).id, admin.id));
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
