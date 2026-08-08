import { addDiscoveryHeaders, buildLlmsText } from "@/lib/public-discovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return addDiscoveryHeaders(
    new Response(buildLlmsText(), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    }),
  );
}
