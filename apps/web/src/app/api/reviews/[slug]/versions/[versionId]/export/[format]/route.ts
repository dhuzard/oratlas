import { NextResponse } from "next/server";
import { bibtex, cslJson, jats, provJsonLd, ris, roCrate } from "@oratlas/exports";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getDocmapForVersion } from "@/lib/editorial-docmap";
import { getVersionExportContext, type VersionExportContext } from "@/lib/preservation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One entry per format: guard, dispatch and response metadata stay together. */
const EXPORTERS: Record<
  string,
  { contentType: string; extension: string; render: (context: VersionExportContext) => string }
> = {
  csl: {
    contentType: "application/vnd.citationstyles.csl+json; charset=utf-8",
    extension: "csl.json",
    render: (context) => JSON.stringify([cslJson(context.exportInput)], null, 2),
  },
  bibtex: {
    contentType: "application/x-bibtex; charset=utf-8",
    extension: "bib",
    render: (context) => bibtex(context.exportInput),
  },
  ris: {
    contentType: "application/x-research-info-systems; charset=utf-8",
    extension: "ris",
    render: (context) => ris(context.exportInput),
  },
  jats: {
    contentType: "application/xml; charset=utf-8",
    extension: "jats.xml",
    render: (context) => jats(context.exportInput),
  },
  "ro-crate": {
    contentType: "application/ld+json; charset=utf-8",
    extension: "ro-crate-metadata.json",
    render: (context) =>
      JSON.stringify(
        roCrate({
          version: context.exportInput,
          files: context.manifest.files,
          snapshotContentHash: context.manifest.integrity.snapshotContentHash,
          capturePayloadHash: context.manifest.integrity.capturePayloadHash,
        }),
        null,
        2,
      ),
  },
  prov: {
    contentType: "application/ld+json; charset=utf-8",
    extension: "prov.jsonld",
    render: (context) => JSON.stringify(provJsonLd(context.provInput), null, 2),
  },
  package: {
    contentType: "application/json; charset=utf-8",
    extension: "preservation.json",
    render: (context) => JSON.stringify(context.manifest, null, 2),
  },
};

/**
 * Standards exports for one immutable version. Every format is produced from
 * the archive database alone, so exports keep working after the upstream
 * repository disappears.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string; format: string }> },
) {
  try {
    const { slug, versionId, format } = await params;
    const filenameBase = `${slug}-${versionId}`.replace(/[^A-Za-z0-9._-]/g, "-");
    if (format === "docmap") {
      const map = await getDocmapForVersion(slug, versionId);
      if (!map) return errorResponse("not-found", "Review version not found.");
      return new NextResponse(JSON.stringify(map, null, 2), {
        headers: {
          "Content-Type": "application/ld+json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filenameBase}.docmap.json"`,
          "X-Content-Type-Options": "nosniff",
          // A later tombstone must revoke this projection immediately.
          "Cache-Control": "no-store, must-revalidate",
          Pragma: "no-cache",
        },
      });
    }
    const exporter = Object.prototype.hasOwnProperty.call(EXPORTERS, format)
      ? EXPORTERS[format]!
      : undefined;
    if (!exporter) return errorResponse("not-found", "Unknown export format.");
    const context = await getVersionExportContext(slug, versionId);
    if (!context) return errorResponse("not-found", "Review version not found.");

    return new NextResponse(exporter.render(context), {
      headers: {
        "Content-Type": exporter.contentType,
        "Content-Disposition": `attachment; filename="${filenameBase}.${exporter.extension}"`,
        "X-Content-Type-Options": "nosniff",
        // A later tombstone must revoke this projection immediately.
        "Cache-Control": "no-store, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
