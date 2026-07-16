import { NextResponse } from "next/server";
import { getPublicSynthesisReview } from "@/lib/synthesis-editorial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const synthesis = await getPublicSynthesisReview(slug);
  return synthesis
    ? NextResponse.json(synthesis)
    : NextResponse.json({ code: "not-found", message: "Synthesis not found." }, { status: 404 });
}
