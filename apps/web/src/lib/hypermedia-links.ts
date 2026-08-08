type ReviewVersionLink = {
  id: string;
  isCurrent: boolean;
  publicState: string;
};

type ReviewLifecycleLink = {
  kind: string;
  reviewVersionId: string;
  supersedesVersionId?: string;
};

export type ReviewHypermediaResource = {
  slug: string;
  version: { id: string };
  versions: ReviewVersionLink[];
  lifecycleEvents: ReviewLifecycleLink[];
};

function appendLink(response: Response, target: string, relation: string, type?: string): void {
  response.headers.append(
    "Link",
    `<${target}>; rel="${relation}"${type ? `; type="${type}"` : ""}`,
  );
}

function readableVersionIds(review: ReviewHypermediaResource): Set<string> {
  return new Set(
    review.versions
      .filter(
        (version) => version.publicState === "published" || version.publicState === "withdrawn",
      )
      .map((version) => version.id),
  );
}

function uniqueCorrectionTarget(
  candidates: Array<string | undefined>,
  readableIds: ReadonlySet<string>,
): string | undefined {
  const targets = new Set(
    candidates.filter((id): id is string => Boolean(id && readableIds.has(id))),
  );
  return targets.size === 1 ? [...targets][0] : undefined;
}

/** Add human and RFC 5829 version-navigation links without exposing withheld versions. */
export function addReviewHypermediaLinks(
  response: Response,
  review: ReviewHypermediaResource,
  exactVersion: boolean,
): Response {
  const slug = encodeURIComponent(review.slug);
  const selectedId = review.version.id;
  const selectedVersionPath = `/reviews/${slug}/versions/${encodeURIComponent(selectedId)}`;
  const currentPath = `/reviews/${slug}`;
  const readableIds = readableVersionIds(review);
  const current = review.versions.find((version) => version.isCurrent);

  appendLink(response, exactVersion ? selectedVersionPath : currentPath, "alternate", "text/html");

  if (current && readableIds.has(current.id)) {
    appendLink(response, currentPath, "latest-version", "text/html");
    appendLink(response, `${currentPath}#record-details`, "version-history", "text/html");
  }

  if (!readableIds.has(selectedId)) return response;

  const corrections = review.lifecycleEvents.filter((event) => event.kind === "correction");
  const predecessorId = uniqueCorrectionTarget(
    corrections
      .filter((event) => event.reviewVersionId === selectedId)
      .map((event) => event.supersedesVersionId),
    readableIds,
  );
  const successorId = uniqueCorrectionTarget(
    corrections
      .filter((event) => event.supersedesVersionId === selectedId)
      .map((event) => event.reviewVersionId),
    readableIds,
  );

  if (predecessorId) {
    appendLink(
      response,
      `/reviews/${slug}/versions/${encodeURIComponent(predecessorId)}`,
      "predecessor-version",
      "text/html",
    );
  }
  if (successorId) {
    appendLink(
      response,
      `/reviews/${slug}/versions/${encodeURIComponent(successorId)}`,
      "successor-version",
      "text/html",
    );
  }

  return response;
}

/** Add an RFC next link while retaining every query value except the replaced cursor. */
export function addNextPageLink(
  response: Response,
  requestUrl: string,
  nextCursor?: string,
): Response {
  if (!nextCursor) return response;

  const url = new URL(requestUrl);
  url.searchParams.set("cursor", nextCursor);
  appendLink(response, `${url.pathname}${url.search}`, "next");
  return response;
}
