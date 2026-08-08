import type { MetadataRoute } from "next";
import { publicUrl } from "@/lib/public-discovery";
import { listSitemapRecords } from "@/lib/sitemap-records";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return (await listSitemapRecords()).map(({ path, lastModified }) => ({
    url: publicUrl(path),
    ...(lastModified ? { lastModified } : {}),
  }));
}
