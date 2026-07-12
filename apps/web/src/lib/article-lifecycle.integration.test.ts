import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type PrismaClient } from "@oratlas/db";
import { type getReviewDetail } from "./reviews";
import { type createReviewComment, type listReviewComments } from "./comments";
import { type getPreservedArticle } from "./article-reader";
import { type getPreservedFileContent, type getVersionExportContext } from "./preservation";
import { type getReviewVersionDiff } from "./version-diff";
import { type getReviewLifecycle, type recordReviewLifecycleEvent } from "./review-lifecycle";
import { type buildKnowledgeIndex } from "./index-builder";
import { type runDiscussion } from "./discuss";

vi.mock("server-only", () => ({}));

const databasePath = `/tmp/oratlas-lifecycle-${process.pid}-${Date.now()}.db`;
const databaseUrl = `file://${databasePath}`;
const commit1 = "1".repeat(40);
const commit2 = "2".repeat(40);
const tree1 = "a".repeat(40);
const tree2 = "b".repeat(40);
const secretTitle = "Sensitive scholarly title";
const secretAbstract = "Sensitive abstract that must vanish after tombstone.";
const secretAuthor = "Sensitive Author";
const secretClaim = "Sensitive claim that must never reach a public boundary.";
const secretCitation = "Sensitive citation title";
const secretComment = "Sensitive community comment";
const article = `# ${secretTitle}\n\n${secretAbstract}\n\n<script>alert('never active')</script>\n`;
const priorTitle = "Earlier public scholarly title";
const priorAbstract = "Earlier public abstract.";
const priorArticle = `# ${priorTitle}\n\n${priorAbstract}\n`;

type Runtime = {
  prisma: PrismaClient;
  reviews: { getReviewDetail: typeof getReviewDetail };
  comments: {
    createReviewComment: typeof createReviewComment;
    listReviewComments: typeof listReviewComments;
  };
  articleReader: { getPreservedArticle: typeof getPreservedArticle };
  preservation: {
    getPreservedFileContent: typeof getPreservedFileContent;
    getVersionExportContext: typeof getVersionExportContext;
  };
  diff: { getReviewVersionDiff: typeof getReviewVersionDiff };
  lifecycle: {
    getReviewLifecycle: typeof getReviewLifecycle;
    recordReviewLifecycleEvent: typeof recordReviewLifecycleEvent;
  };
  indexBuilder: { buildKnowledgeIndex: typeof buildKnowledgeIndex };
  discuss: { runDiscussion: typeof runDiscussion };
};

let runtime: Runtime;
let editorId: string;
let commenterId: string;
let version1Id: string;
let version2Id: string;
let concurrentVersionId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.AUTH_MOCK = "1";
  execFileSync(
    resolve(process.cwd(), "packages/db/node_modules/.bin/prisma"),
    ["db", "push", "--schema", "packages/db/prisma/schema.prisma", "--skip-generate"],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" },
      stdio: "pipe",
    },
  );
  const { prisma } = await import("./db");
  runtime = {
    prisma,
    reviews: await import("./reviews"),
    comments: await import("./comments"),
    articleReader: await import("./article-reader"),
    preservation: await import("./preservation"),
    diff: await import("./version-diff"),
    lifecycle: await import("./review-lifecycle"),
    indexBuilder: await import("./index-builder"),
    discuss: await import("./discuss"),
  };

  const editor = await prisma.user.create({
    data: { githubUserId: "lifecycle-editor", githubLogin: "lifecycle-editor", role: "EDITOR" },
  });
  const commenter = await prisma.user.create({
    data: { githubUserId: "lifecycle-commenter", githubLogin: "lifecycle-commenter" },
  });
  editorId = editor.id;
  commenterId = commenter.id;

  const repository = await prisma.repository.create({
    data: {
      owner: "lab",
      name: "sensitive-review",
      canonicalUrl: "https://github.com/lab/sensitive-review",
      defaultBranch: "main",
    },
  });
  const [snapshot1, snapshot2] = await Promise.all([
    prisma.repositorySnapshot.create({
      data: {
        repositoryId: repository.id,
        commitSha: commit1,
        sourceTreeSha: tree1,
        branch: "main",
        inspectionStatus: "succeeded",
        inspectionReportJson: storageReport(commit1, tree1, priorArticle),
        preservedFilesJson: preserved(priorArticle),
        contentHash: "c".repeat(64),
      },
    }),
    prisma.repositorySnapshot.create({
      data: {
        repositoryId: repository.id,
        commitSha: commit2,
        sourceTreeSha: tree2,
        branch: "main",
        inspectionStatus: "succeeded",
        inspectionReportJson: storageReport(commit2, tree2, `${article}\nRevised.`),
        preservedFilesJson: preserved(`${article}\nRevised.`),
        contentHash: "d".repeat(64),
      },
    }),
  ]);
  const review = await prisma.review.create({
    data: {
      slug: "sensitive-review",
      repositoryId: repository.id,
      currentSnapshotId: snapshot2.id,
      title: secretTitle,
      abstract: secretAbstract,
      status: "published",
      acceptedAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  });
  const version1 = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: snapshot1.id,
      sourceKind: "default-branch",
      sourceBranch: "main",
      sourceSelectionKey: "commit:1",
      semanticVersion: "1.0.0",
      title: priorTitle,
      abstract: priorAbstract,
      metadataJson: JSON.stringify({ keywords: ["public"], domains: ["Safety"] }),
      publishedAt: new Date("2026-07-01T00:00:00.000Z"),
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  });
  const version2 = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: snapshot2.id,
      sourceKind: "release",
      sourceSelectionKey: "release:v2",
      semanticVersion: "2.0.0",
      title: secretTitle,
      abstract: secretAbstract,
      metadataJson: JSON.stringify({ keywords: ["secret", "revised"], domains: ["Safety"] }),
      publishedAt: new Date("2026-07-02T00:00:00.000Z"),
      createdAt: new Date("2026-07-02T00:00:00.000Z"),
    },
  });
  version1Id = version1.id;
  version2Id = version2.id;

  const person = await prisma.person.create({ data: { displayName: secretAuthor } });
  await prisma.reviewContributor.create({
    data: { reviewVersionId: version2.id, personId: person.id, position: 0 },
  });
  const claim = await prisma.claim.create({
    data: {
      reviewVersionId: version2.id,
      localClaimId: "claim-secret",
      text: secretClaim,
      normalizedText: secretClaim.toLowerCase(),
      section: "Results",
    },
  });
  const citation = await prisma.citation.create({
    data: {
      reviewVersionId: version2.id,
      localCitationId: "citation-secret",
      title: secretCitation,
    },
  });
  await prisma.claimEvidenceRelation.create({
    data: { claimId: claim.id, citationId: citation.id, relationType: "supports" },
  });
  await prisma.reviewComment.create({
    data: {
      reviewId: review.id,
      reviewVersionId: version2.id,
      authorId: commenter.id,
      body: secretComment,
    },
  });

  // A branch field must never rescue an invalid/mutable commit identity.
  const invalidRepository = await prisma.repository.create({
    data: {
      owner: "lab",
      name: "invalid-review",
      canonicalUrl: "https://github.com/lab/invalid-review",
      defaultBranch: "main",
    },
  });
  const invalidSnapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: invalidRepository.id,
      commitSha: "0".repeat(40),
      branch: "main",
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      preservedFilesJson: preserved("# Must not be read"),
      contentHash: "e".repeat(64),
    },
  });
  const invalidReview = await prisma.review.create({
    data: {
      slug: "invalid-review",
      repositoryId: invalidRepository.id,
      title: "Mutable fallback",
      status: "published",
    },
  });
  await prisma.reviewVersion.create({
    data: {
      reviewId: invalidReview.id,
      snapshotId: invalidSnapshot.id,
      sourceKind: "default-branch",
      sourceBranch: "main",
      title: "Mutable fallback",
      metadataJson: "{}",
      publishedAt: new Date(),
    },
  });

  const concurrentRepository = await prisma.repository.create({
    data: {
      owner: "lab",
      name: "concurrent-review",
      canonicalUrl: "https://github.com/lab/concurrent-review",
    },
  });
  const concurrentSnapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: concurrentRepository.id,
      commitSha: "3".repeat(40),
      branch: "main",
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: "3".repeat(64),
    },
  });
  const concurrentReview = await prisma.review.create({
    data: {
      slug: "concurrent-review",
      repositoryId: concurrentRepository.id,
      title: "Concurrent lifecycle test",
      status: "published",
    },
  });
  const concurrentVersion = await prisma.reviewVersion.create({
    data: {
      reviewId: concurrentReview.id,
      snapshotId: concurrentSnapshot.id,
      title: "Concurrent lifecycle test",
      metadataJson: "{}",
      publishedAt: new Date(),
    },
  });
  concurrentVersionId = concurrentVersion.id;
}, 30_000);

afterAll(async () => {
  await runtime?.prisma.$disconnect();
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) rmSync(path);
  }
});

describe.sequential("article lifecycle public boundaries", () => {
  it("reads the article and computes deterministic archived diffs without upstream access", async () => {
    const document = await runtime.articleReader.getPreservedArticle(
      "sensitive-review",
      version2Id,
    );
    expect(document?.path).toBe("README.md");
    expect(document?.blocks.some((block) => JSON.stringify(block).includes("<script>"))).toBe(true);

    const [{ GET: fileGet }, { GET: exportGet }, { GET: diffGet }, { GET: atomGet }] =
      await Promise.all([
        import("../app/api/reviews/[slug]/versions/[versionId]/files/[...path]/route"),
        import("../app/api/reviews/[slug]/versions/[versionId]/export/[format]/route"),
        import("../app/api/reviews/[slug]/diff/route"),
        import("../app/api/feeds/atom/route"),
      ]);
    const cacheGuardedResponses = await Promise.all([
      fileGet(new Request("http://localhost/file"), {
        params: Promise.resolve({
          slug: "sensitive-review",
          versionId: version2Id,
          path: ["README.md"],
        }),
      }),
      exportGet(new Request("http://localhost/export"), {
        params: Promise.resolve({
          slug: "sensitive-review",
          versionId: version2Id,
          format: "package",
        }),
      }),
      diffGet(
        new Request(
          `http://localhost/api/reviews/sensitive-review/diff?from=${version1Id}&to=${version2Id}`,
        ),
        { params: Promise.resolve({ slug: "sensitive-review" }) },
      ),
      atomGet(),
    ]);
    for (const response of cacheGuardedResponses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("cache-control")).not.toContain("immutable");
    }
    expect(
      await runtime.preservation.getPreservedFileContent(
        "sensitive-review",
        version2Id,
        "../README.md",
      ),
    ).toBeNull();

    const first = await runtime.diff.getReviewVersionDiff(
      "sensitive-review",
      version1Id,
      version2Id,
    );
    const second = await runtime.diff.getReviewVersionDiff(
      "sensitive-review",
      version1Id,
      version2Id,
    );
    expect(first).toEqual(second);
    expect(first?.sections.assets.changed.map((change) => change.key)).toEqual(["README.md"]);
    expect(first?.sections.metadata.changed).toHaveLength(1);
    expect(await runtime.reviews.getReviewDetail("invalid-review")).toBeNull();
    expect(
      await runtime.articleReader.getPreservedArticle(
        "invalid-review",
        (
          await runtime.prisma.reviewVersion.findFirstOrThrow({
            where: { review: { slug: "invalid-review" } },
          })
        ).id,
      ),
    ).toBeNull();
  });

  it("enforces same-review correction links and records attributable CAS events", async () => {
    const otherVersion = await runtime.prisma.reviewVersion.findFirstOrThrow({
      where: { review: { slug: "invalid-review" } },
    });
    await runtime.prisma.review.update({
      where: { slug: "invalid-review" },
      data: { status: "draft" },
    });
    await expect(
      runtime.lifecycle.recordReviewLifecycleEvent(
        {
          reviewSlug: "invalid-review",
          reviewVersionId: otherVersion.id,
          kind: "withdrawal",
          reason: "Private reviews cannot emit a public lifecycle event.",
          expectedRevision: 0,
        },
        editorId,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
    await runtime.prisma.review.update({
      where: { slug: "invalid-review" },
      data: { status: "published" },
    });
    await runtime.prisma.reviewVersion.update({
      where: { id: otherVersion.id },
      data: { publishedAt: null },
    });
    await expect(
      runtime.lifecycle.recordReviewLifecycleEvent(
        {
          reviewSlug: "invalid-review",
          reviewVersionId: otherVersion.id,
          kind: "withdrawal",
          reason: "An unpublished version cannot emit a public lifecycle event.",
          expectedRevision: 0,
        },
        editorId,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
    await runtime.prisma.reviewVersion.update({
      where: { id: otherVersion.id },
      data: { publishedAt: new Date("2026-07-01T00:00:00.000Z") },
    });

    await expect(
      runtime.lifecycle.recordReviewLifecycleEvent(
        {
          reviewSlug: "sensitive-review",
          reviewVersionId: version2Id,
          supersedesVersionId: otherVersion.id,
          kind: "correction",
          reason: "Correction must not cross the review identity boundary.",
          expectedRevision: 0,
        },
        editorId,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });

    await expect(
      runtime.lifecycle.recordReviewLifecycleEvent(
        {
          reviewSlug: "sensitive-review",
          reviewVersionId: version1Id,
          supersedesVersionId: version2Id,
          kind: "correction",
          reason: "A historical version cannot be the correction target.",
          expectedRevision: 0,
        },
        editorId,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });

    await runtime.prisma.reviewVersion.update({
      where: { id: version2Id },
      data: { publicState: "withdrawn" },
    });
    await expect(
      runtime.lifecycle.recordReviewLifecycleEvent(
        {
          reviewSlug: "sensitive-review",
          reviewVersionId: version2Id,
          supersedesVersionId: version1Id,
          kind: "correction",
          reason: "A withdrawn current version cannot be a correction target.",
          expectedRevision: 0,
        },
        editorId,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
    await runtime.prisma.reviewVersion.update({
      where: { id: version2Id },
      data: { publicState: "published" },
    });

    await runtime.prisma.reviewVersion.update({
      where: { id: version1Id },
      data: { createdAt: new Date("2027-01-01T00:00:00.000Z") },
    });
    await expect(
      runtime.lifecycle.recordReviewLifecycleEvent(
        {
          reviewSlug: "sensitive-review",
          reviewVersionId: version2Id,
          supersedesVersionId: version1Id,
          kind: "correction",
          reason: "A correction cannot supersede a chronologically later version.",
          expectedRevision: 0,
        },
        editorId,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
    await runtime.prisma.reviewVersion.update({
      where: { id: version1Id },
      data: { createdAt: new Date("2026-07-01T00:00:00.000Z") },
    });

    const result = await runtime.lifecycle.recordReviewLifecycleEvent(
      {
        reviewSlug: "sensitive-review",
        reviewVersionId: version2Id,
        supersedesVersionId: version1Id,
        kind: "correction",
        reason: "The current version corrects the prior archived scholarly record.",
        expectedRevision: 0,
      },
      editorId,
    );
    expect(result.revision).toBe(1);
    expect(result.event.actorLogin).toBe("lifecycle-editor");
    const prior = await runtime.reviews.getReviewDetail("sensitive-review", version1Id);
    expect(prior?.lifecycleEvents[0]?.reviewVersionId).toBe(version2Id);
    const commentBeforeTombstone = await runtime.comments.createReviewComment(
      "sensitive-review",
      {
        id: commenterId,
        githubLogin: "lifecycle-commenter",
        displayName: null,
        avatarUrl: null,
        profileUrl: null,
        role: "USER",
      },
      { kind: "comment", body: "A valid comment committed before the tombstone." },
    );
    expect(commentBeforeTombstone.id).toBeTruthy();

    await runtime.prisma.reviewVersion.update({
      where: { id: version1Id },
      data: { publicState: "tombstoned" },
    });
    await expect(
      runtime.lifecycle.recordReviewLifecycleEvent(
        {
          reviewSlug: "sensitive-review",
          reviewVersionId: version2Id,
          supersedesVersionId: version1Id,
          kind: "correction",
          reason: "A correction cannot supersede a tombstoned prior version.",
          expectedRevision: 1,
        },
        editorId,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
    await runtime.prisma.reviewVersion.update({
      where: { id: version1Id },
      data: { publicState: "published" },
    });

    await expect(
      runtime.lifecycle.recordReviewLifecycleEvent(
        {
          reviewSlug: "sensitive-review",
          reviewVersionId: version2Id,
          kind: "withdrawal",
          reason: "This stale revision must lose the optimistic concurrency race.",
          expectedRevision: 0,
        },
        editorId,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("tombstones atomically and leaks no scholarly payload through public services", async () => {
    await runtime.lifecycle.recordReviewLifecycleEvent(
      {
        reviewSlug: "sensitive-review",
        reviewVersionId: version2Id,
        kind: "tombstone",
        reason: "Content is withheld under the documented public safety procedure.",
        expectedRevision: 1,
      },
      editorId,
    );

    const detail = await runtime.reviews.getReviewDetail("sensitive-review");
    expect(detail).toMatchObject({
      title: "Content unavailable",
      isTombstoned: true,
      contributors: [],
      claims: [],
      citations: [],
    });
    expect(detail?.abstract).toBeUndefined();
    const serializedDetail = JSON.stringify(detail);
    for (const secret of [
      secretTitle,
      secretAbstract,
      secretAuthor,
      secretClaim,
      secretCitation,
      secretComment,
    ]) {
      expect(serializedDetail).not.toContain(secret);
    }

    const comments = await runtime.comments.listReviewComments("sensitive-review");
    expect(comments?.comments).toEqual([]);
    await expect(
      runtime.comments.createReviewComment(
        "sensitive-review",
        {
          id: commenterId,
          githubLogin: "lifecycle-commenter",
          displayName: null,
          avatarUrl: null,
          profileUrl: null,
          role: "USER",
        },
        { kind: "comment", body: "This must be rejected on a tombstone." },
      ),
    ).rejects.toThrow("Comments are closed");

    expect(
      await runtime.articleReader.getPreservedArticle("sensitive-review", version2Id),
    ).toBeNull();
    expect(
      await runtime.preservation.getPreservedFileContent(
        "sensitive-review",
        version2Id,
        "README.md",
      ),
    ).toBeNull();
    expect(
      await runtime.preservation.getVersionExportContext("sensitive-review", version2Id),
    ).toBeNull();
    expect(
      await runtime.diff.getReviewVersionDiff("sensitive-review", version1Id, version2Id),
    ).toBeNull();

    const index = await runtime.indexBuilder.buildKnowledgeIndex();
    const serializedIndex = JSON.stringify(index);
    expect(index.reviews.some((review) => review.reviewSlug === "sensitive-review")).toBe(false);
    expect(index.claims).toEqual([]);
    expect(serializedIndex).not.toContain(secretClaim);
    const discussion = await runtime.discuss.runDiscussion("What does the sensitive review say?", [
      "sensitive-review",
    ]);
    expect(JSON.stringify(discussion)).not.toContain(secretClaim);
  }, 30_000);

  it("allows exactly one of two concurrent lifecycle writers", async () => {
    const common = {
      reviewSlug: "concurrent-review",
      reviewVersionId: concurrentVersionId,
      expectedRevision: 0,
    } as const;
    const results = await Promise.allSettled([
      runtime.lifecycle.recordReviewLifecycleEvent(
        {
          ...common,
          kind: "withdrawal",
          reason: "First concurrent editor action with a complete public rationale.",
        },
        editorId,
      ),
      runtime.lifecycle.recordReviewLifecycleEvent(
        {
          ...common,
          kind: "tombstone",
          reason: "Second concurrent editor action with a complete public rationale.",
        },
        editorId,
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const ledger = await runtime.lifecycle.getReviewLifecycle("concurrent-review");
    expect(ledger).toMatchObject({ revision: 1 });
    expect(ledger?.events).toHaveLength(1);
  }, 30_000);

  it("sanitizes review/search/claims/comments/feed/head routes after tombstone", async () => {
    const [{ GET: reviewGet }, { GET: searchGet }, { GET: claimsGet }] = await Promise.all([
      import("../app/api/reviews/[slug]/route"),
      import("../app/api/search/route"),
      import("../app/api/claims/route"),
    ]);
    const [{ GET: commentsGet }, { GET: atomGet }, { GET: lifecycleFeedGet }] = await Promise.all([
      import("../app/api/reviews/[slug]/comments/route"),
      import("../app/api/feeds/atom/route"),
      import("../app/api/feeds/lifecycle/route"),
    ]);
    const { generateMetadata } = await import("../app/reviews/[slug]/page");

    const responses = await Promise.all([
      reviewGet(new Request("http://localhost/api/reviews/sensitive-review"), {
        params: Promise.resolve({ slug: "sensitive-review" }),
      }),
      searchGet(new Request("http://localhost/api/search?q=Sensitive")),
      claimsGet(new Request("http://localhost/api/claims?q=Sensitive")),
      commentsGet(new Request("http://localhost/api/reviews/sensitive-review/comments"), {
        params: Promise.resolve({ slug: "sensitive-review" }),
      }),
      atomGet(),
    ]);
    for (const response of responses) {
      const body = await response.text();
      for (const secret of [
        secretTitle,
        secretAbstract,
        secretAuthor,
        secretClaim,
        secretCitation,
        secretComment,
      ]) {
        expect(body).not.toContain(secret);
      }
    }
    const lifecycleResponse = await lifecycleFeedGet();
    expect(lifecycleResponse.headers.get("cache-control")).toContain("no-store");
    expect(lifecycleResponse.headers.get("cache-control")).not.toContain("public");
    const lifecycleBody = await lifecycleResponse.text();
    expect(lifecycleBody).toContain("tombstone");
    expect(lifecycleBody).not.toContain(secretTitle);
    await runtime.prisma.reviewVersion.update({
      where: { id: version2Id },
      data: { publishedAt: null },
    });
    const unpublishedLifecycleBody = await (await lifecycleFeedGet()).text();
    expect(unpublishedLifecycleBody).not.toContain("sensitive-review");
    await runtime.prisma.reviewVersion.update({
      where: { id: version2Id },
      data: { publishedAt: new Date("2026-07-02T00:00:00.000Z") },
    });
    await runtime.prisma.review.update({
      where: { slug: "sensitive-review" },
      data: { status: "draft" },
    });
    const privateLifecycleBody = await (await lifecycleFeedGet()).text();
    expect(privateLifecycleBody).not.toContain("sensitive-review");
    expect(privateLifecycleBody).not.toContain(
      "Content is withheld under the documented public safety procedure.",
    );
    await runtime.prisma.review.update({
      where: { slug: "sensitive-review" },
      data: { status: "published" },
    });
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "sensitive-review", versionId: version2Id }),
    });
    expect(metadata.title).toBe("Content unavailable");
    expect(metadata.description).not.toContain(secretAbstract);
  }, 30_000);
});

function preserved(content: string): string {
  return JSON.stringify({
    "README.md": { size: Buffer.byteLength(content, "utf8"), truncated: false, content },
  });
}

function storageReport(commitSha: string, treeSha: string, content: string): string {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    repositoryUrl: "https://github.com/lab/sensitive-review",
    commitSha,
    treeSha,
    files: {
      "README.md": {
        size: Buffer.byteLength(content, "utf8"),
        truncated: false,
        contentHash: "f".repeat(64),
      },
    },
  });
}
