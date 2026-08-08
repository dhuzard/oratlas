import type { MetadataRoute } from "next";
import { publicUrl } from "@/lib/public-discovery";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/signin",
        "/editorial",
        "/notifications",
        "/submit",
        "/submissions",
        "/api/auth/",
        "/api/editorial/",
        "/api/admin/",
        "/api/submissions",
      ],
    },
    sitemap: publicUrl("/sitemap.xml"),
    host: publicUrl("/").replace(/\/$/, ""),
  };
}
