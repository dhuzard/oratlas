-- Observational follow-up only; NOT part of the shared1165 initial fixture load.
-- Native visible comment control keeps real post-removal public reads populated.
INSERT INTO "ReviewComment" ("id","reviewId","reviewVersionId","authorId","kind","body","status","createdAt","updatedAt")
VALUES ('g1-fresh-remaining','g1-review-1','g1-version-2','g1-user-b-only','comment','Synthetic remaining public comment after the three independent removal operations.','visible','2026-03-12','2026-03-12');
