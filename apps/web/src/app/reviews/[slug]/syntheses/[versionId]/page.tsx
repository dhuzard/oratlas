import { type Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicSynthesisReviewVersion } from "@/lib/synthesis-editorial";
import { loadSynthesisReadingContext } from "@/lib/synthesis-reading";
import { SynthesisReader } from "../../SynthesisReader";

export const dynamic = "force-dynamic";

interface SynthesisVersionPageProps {
  params: Promise<{ slug: string; versionId: string }>;
}

export async function generateMetadata({ params }: SynthesisVersionPageProps): Promise<Metadata> {
  const { slug, versionId } = await params;
  const synthesis = await getPublicSynthesisReviewVersion(slug, versionId);
  if (!synthesis) return { title: "Synthesis version not found" };
  return {
    title: `${synthesis.title} — accepted version ${synthesis.version.ordinal}`,
    description: synthesis.abstract.slice(0, 200),
    alternates: { canonical: `/reviews/${slug}/syntheses/${versionId}` },
  };
}

export default async function SynthesisVersionPage({ params }: SynthesisVersionPageProps) {
  const { slug, versionId } = await params;
  const synthesis = await getPublicSynthesisReviewVersion(slug, versionId);
  if (!synthesis) notFound();
  const [reading, requestHeaders] = await Promise.all([
    loadSynthesisReadingContext(synthesis),
    headers(),
  ]);
  if (!reading) notFound();
  return (
    <SynthesisReader
      synthesis={synthesis}
      reading={reading}
      nonce={requestHeaders.get("x-nonce") ?? undefined}
    />
  );
}
