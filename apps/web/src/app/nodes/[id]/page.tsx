import { notFound } from "next/navigation";
import { type Metadata } from "next";
import { appBaseUrl } from "@/lib/base-url";
import { serializeJsonForHtml } from "@/lib/json-for-html";
import { nodeJsonLd } from "@/lib/node-jsonld";
import { getPublicNode } from "@/lib/node-publication";
import { NodeView } from "./NodeView";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: NodePageProps): Promise<Metadata> {
  const { id } = await params;
  const node = await getPublicNode(id);
  if (!node) return { title: "Knowledge node not found" };
  return {
    title: node.version.title,
    description: node.version.abstract ?? node.version.text ?? node.version.title,
    alternates: { canonical: `/nodes/${node.id}` },
    openGraph: { title: node.version.title, type: "article" },
  };
}

export default async function NodePage({ params }: NodePageProps) {
  const { id } = await params;
  const node = await getPublicNode(id);
  if (!node) notFound();
  const canonicalUrl = `${appBaseUrl()}/nodes/${node.id}`;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonForHtml(nodeJsonLd(node, canonicalUrl)) }}
      />
      <NodeView node={node} />
    </>
  );
}

interface NodePageProps {
  params: Promise<{ id: string }>;
}
