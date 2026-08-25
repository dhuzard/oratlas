import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import {
  listPublicationVersionContributors,
  PublicationContributorsError,
} from "@/lib/publication-contributors";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await listPublicationVersionContributors((await params).id));
  } catch (error) {
    if (error instanceof PublicationContributorsError) {
      return errorResponse(error.code, error.message);
    }
    throw error;
  }
}
