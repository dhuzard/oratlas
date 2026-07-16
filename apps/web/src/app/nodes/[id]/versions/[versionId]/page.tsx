import { notFound } from "next/navigation";
import { type Metadata } from "next";
import { appBaseUrl } from "@/lib/base-url";
import { serializeJsonForHtml } from "@/lib/json-for-html";
import { nodeJsonLd } from "@/lib/node-jsonld";
import { getPublicNode } from "@/lib/node-publication";
import { NodeView } from "../../NodeView";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: VersionPageProps): Promise<Metadata> {
  const { id, versionId } = await params;
  const node = await getPublicNode(id, versionId);
  if (!node) return { title: "Knowledge node version not found" };
  return {
    title: `${node.version.title} — historical version`,
    description: node.version.abstract ?? node.version.text ?? node.version.title,
    alternates: { canonical: `/nodes/${node.id}/versions/${node.version.id}` },
  };
}

export default async function NodeVersionPage({ params }: VersionPageProps) {
  const { id, versionId } = await params;
  const node = await getPublicNode(id, versionId);
  if (!node) notFound();
  const canonicalUrl = `${appBaseUrl()}/nodes/${node.id}/versions/${node.version.id}`;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonForHtml(nodeJsonLd(node, canonicalUrl)) }}
      />
      <NodeView node={node} historical />
    </>
  );
}

interface VersionPageProps {
  params: Promise<{ id: string; versionId: string }>;
}
