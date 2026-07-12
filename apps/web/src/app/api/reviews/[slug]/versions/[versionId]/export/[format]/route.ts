import { NextResponse } from "next/server";
import { bibtex, cslJson, jats, provJsonLd, ris, roCrate } from "@oratlas/exports";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getVersionExportContext } from "@/lib/preservation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORMATS = ["csl", "bibtex", "ris", "jats", "ro-crate", "prov", "package"] as const;
type ExportFormat = (typeof FORMATS)[number];

function isExportFormat(value: string): value is ExportFormat {
  return (FORMATS as readonly string[]).includes(value);
}

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
    if (!isExportFormat(format)) {
      return errorResponse("not-found", "Unknown export format.");
    }
    const context = await getVersionExportContext(slug, versionId);
    if (!context) return errorResponse("not-found", "Review version not found.");

    const filenameBase = `${slug}-${versionId}`.replace(/[^A-Za-z0-9._-]/g, "-");
    const respond = (body: string, contentType: string, extension: string) =>
      new NextResponse(body, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filenameBase}.${extension}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=300",
        },
      });

    switch (format) {
      case "csl":
        return respond(
          JSON.stringify([cslJson(context.exportInput)], null, 2),
          "application/vnd.citationstyles.csl+json; charset=utf-8",
          "csl.json",
        );
      case "bibtex":
        return respond(bibtex(context.exportInput), "application/x-bibtex; charset=utf-8", "bib");
      case "ris":
        return respond(
          ris(context.exportInput),
          "application/x-research-info-systems; charset=utf-8",
          "ris",
        );
      case "jats":
        return respond(jats(context.exportInput), "application/xml; charset=utf-8", "jats.xml");
      case "ro-crate":
        return respond(
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
          "application/ld+json; charset=utf-8",
          "ro-crate-metadata.json",
        );
      case "prov":
        return respond(
          JSON.stringify(provJsonLd(context.provInput), null, 2),
          "application/ld+json; charset=utf-8",
          "prov.jsonld",
        );
      case "package":
        return respond(
          JSON.stringify(context.manifest, null, 2),
          "application/json; charset=utf-8",
          "preservation.json",
        );
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
