import { expect, it } from "vitest";
import { SUPPLEMENTAL_PROGRAMS } from "./supplemental-programs.js";
import { PUBLIC_COLUMN_UPDATE_GRANTS, PUBLIC_TABLE_GRANTS, createPublicRoleSql } from "./sql.js";
import {
  RESPONSE_MODERATION_PROGRAM,
  RESPONSE_MODERATION_EXTRA_COLUMNS,
} from "./response-moderation-scenarios.js";

import {
  CHALLENGE_MODERATION_PROGRAM,
  CHALLENGE_MODERATION_EXTRA_COLUMNS,
} from "./challenge-moderation-scenarios.js";

it("registers two separately reset terminal programs with exactly five and six column-scoped privileges", () => {
  expect(SUPPLEMENTAL_PROGRAMS.filter((p) => p.name === RESPONSE_MODERATION_PROGRAM.name)).toEqual([
    RESPONSE_MODERATION_PROGRAM,
  ]);
  expect(RESPONSE_MODERATION_PROGRAM.spec).toBe("response-moderation.g1.spec.ts");
  expect(SUPPLEMENTAL_PROGRAMS.filter((p) => p.name === CHALLENGE_MODERATION_PROGRAM.name)).toEqual(
    [CHALLENGE_MODERATION_PROGRAM],
  );
  expect(CHALLENGE_MODERATION_PROGRAM.spec).toBe("challenge-moderation.g1.spec.ts");
  expect(CHALLENGE_MODERATION_PROGRAM.fixtures).toEqual(RESPONSE_MODERATION_PROGRAM.fixtures);
  expect(CHALLENGE_MODERATION_PROGRAM.addedRows).toEqual(RESPONSE_MODERATION_PROGRAM.addedRows);
  expect(PUBLIC_COLUMN_UPDATE_GRANTS.find((g) => String(g.table) === "Challenge")?.columns).toEqual(
    CHALLENGE_MODERATION_EXTRA_COLUMNS,
  );

  expect(RESPONSE_MODERATION_PROGRAM.fixtures).toEqual([
    "fixtures/response-moderation-fixtures.sql",
  ]);
  const grant = PUBLIC_COLUMN_UPDATE_GRANTS.find((g) => g.table === "ChallengeResponse");
  expect(grant?.columns).toEqual(RESPONSE_MODERATION_EXTRA_COLUMNS);
  expect(PUBLIC_COLUMN_UPDATE_GRANTS.flatMap((g) => g.columns)).toHaveLength(39);
  expect(PUBLIC_COLUMN_UPDATE_GRANTS.find((g) => String(g.table) === "Challenge")?.columns).toEqual(
    [
      "contentStatus",
      "contentRevision",
      "removedAt",
      "removedById",
      "removedByRoleSnapshot",
      "updatedAt",
    ],
  );
  expect(
    PUBLIC_TABLE_GRANTS.filter((g) => g.table === "ChallengeResponse").map(
      ({ table, privileges }) => ({ table, privileges }),
    ),
  ).toEqual([{ table: "ChallengeResponse", privileges: ["SELECT"] }]);
  const sql = createPublicRoleSql("oratlas_g1_public", "synthetic-test-password");
  expect(sql).toContain(
    'GRANT UPDATE ("contentStatus", "contentRevision", "removedAt", "removedById", "removedByRoleSnapshot") ON TABLE public."ChallengeResponse" TO "oratlas_g1_public";',
  );
  expect(sql).not.toMatch(
    /GRANT UPDATE ON|GRANT ALL|GRANT INSERT ON TABLE public\."ChallengeResponse"/u,
  );
});
