import { quoteIdent, quoteLiteral } from "./postgres.js";
import { PRIVATE_SCHEMA } from "./target.js";

/**
 * SQL used by the G1 harness. Identifiers are validated and quoted by `quoteIdent`; passwords are
 * quoted literals sent on stdin only. Every query returns one JSON value for `queryJson`.
 */

/**
 * Minimal reviewed public grant closure for the captured scenarios — not a production-wide
 * permission policy. Every table is listed with the production code path that needs it; a missing
 * entry makes a captured handler fail (500) and the capture expectations fail, so the list cannot
 * silently shrink coverage. No DELETE, TRUNCATE, REFERENCES, TRIGGER or DDL is granted, and writes
 * are column-scoped except the append-only audit insert.
 */
export const PUBLIC_TABLE_GRANTS = [
  {
    table: "AuditEvent",
    privileges: ["SELECT", "INSERT"],
    reason:
      "audit append for ORCID/certifier/notification mutations; Prisma create returns the row",
  },
  {
    table: "CertificationProtocol",
    privileges: ["SELECT"],
    reason: "ORA readiness protocol lookup",
  },
  {
    table: "Certifier",
    privileges: ["SELECT"],
    reason: "certifier status mutation and ORA readiness relation filter",
  },
  {
    table: "Citation",
    privileges: ["SELECT"],
    reason: "knowledge index (search/claims) and canonical-graph readability predicate",
  },
  {
    table: "Claim",
    privileges: ["SELECT"],
    reason: "knowledge index (search/claims) and canonical-graph readability predicate",
  },
  {
    table: "ClaimEvidenceRelation",
    privileges: ["SELECT"],
    reason: "knowledge index evidence relations; graph edge include",
  },
  {
    table: "KnowledgeNode",
    privileges: ["SELECT"],
    reason: "canonical graph seed/edges and sitemap node records",
  },
  {
    table: "KnowledgeNodeVersion",
    privileges: ["SELECT"],
    reason: "canonical graph versions, sitemap nodes, claim/citation graph versions",
  },
  { table: "NodeAlias", privileges: ["SELECT"], reason: "canonical graph node aliases include" },
  { table: "NodeEdge", privileges: ["SELECT"], reason: "canonical graph source assertions" },
  {
    table: "Notification",
    privileges: ["SELECT"],
    reason: "per-user notification list and mark-read",
  },
  { table: "Person", privileges: ["SELECT"], reason: "Atom feed and knowledge index contributors" },
  {
    table: "Publication",
    privileges: ["SELECT"],
    reason: "canonical-graph readability predicate (external publication branch)",
  },
  {
    table: "PublicationCapture",
    privileges: ["SELECT"],
    reason: "canonical graph publication-occurrence include",
  },
  {
    table: "PublicationClaimOccurrence",
    privileges: ["SELECT"],
    reason: "canonical-graph readability predicate and include",
  },
  {
    table: "PublicationVersion",
    privileges: ["SELECT"],
    reason: "ORA readiness publication version read; graph predicate",
  },
  {
    table: "Repository",
    privileges: ["SELECT"],
    reason: "canonical graph repository select and sitemap node query",
  },
  {
    table: "RepositorySnapshot",
    privileges: ["SELECT"],
    reason: "feeds, index, sitemap, graph snapshot SHAs",
  },
  {
    table: "Review",
    privileges: ["SELECT"],
    reason: "feeds, index, sitemap, lifecycle and readability predicates",
  },
  {
    table: "ReviewContributor",
    privileges: ["SELECT"],
    reason: "Atom feed and knowledge index contributors",
  },
  { table: "ReviewLifecycleEvent", privileges: ["SELECT"], reason: "lifecycle ledger feed" },
  {
    table: "ReviewVersion",
    privileges: ["SELECT"],
    reason: "feeds, index, sitemap, lifecycle and readability predicates",
  },
  {
    table: "Submission",
    privileges: ["SELECT"],
    reason: "readable node-version predicate (node-only acceptance branch)",
  },
  {
    table: "SynthesisDraft",
    privileges: ["SELECT"],
    reason: "sitemap review projection selects the synthesis draft relation",
  },
  {
    table: "TrustAssessment",
    privileges: ["SELECT"],
    reason: "knowledge index and graph edge TRUST include",
  },
  {
    table: "TrustVerification",
    privileges: ["SELECT"],
    reason: "knowledge index and graph edge TRUST verification include",
  },
  {
    table: "User",
    privileges: ["SELECT"],
    reason: "session resolution (getCurrentUser) and lifecycle actor login",
  },
] as const satisfies ReadonlyArray<{
  table: string;
  privileges: ReadonlyArray<"SELECT" | "INSERT">;
  reason: string;
}>;

/** Column-only UPDATE grants; table-level UPDATE is never granted. */
export const PUBLIC_COLUMN_UPDATE_GRANTS = [
  {
    table: "Certifier",
    columns: ["activatedAt", "retiredAt", "status"],
    reason: "setCertifierStatus",
  },
  { table: "Notification", columns: ["readAt"], reason: "markNotificationRead (own notification)" },
  {
    table: "User",
    columns: ["orcid", "orcidVerifiedAt", "updatedAt"],
    reason: "setUserOrcid (Prisma stamps updatedAt)",
  },
] as const satisfies ReadonlyArray<{ table: string; columns: readonly string[]; reason: string }>;

/** Tables the restricted public role may read (row-count evidence covers exactly these). */
export const PUBLIC_SELECT_TABLES: readonly string[] = PUBLIC_TABLE_GRANTS.map(
  (grant) => grant.table,
);

const TABLE_NAME = /^[A-Z][A-Za-z0-9]{0,62}$/u;
const COLUMN_NAME = /^[a-z][A-Za-z0-9]{0,62}$/u;

function publicTable(table: string): string {
  if (!TABLE_NAME.test(table)) throw new Error("Unexpected table name");
  return `public."${table}"`;
}

function column(name: string): string {
  if (!COLUMN_NAME.test(name)) throw new Error("Unexpected column name");
  return `"${name}"`;
}

const SYSTEM_SCHEMA_FILTER = `n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'`;

/** Target facts and cleanliness checks run by the admin connection before any mutation. */
export function preflightSql(roles: readonly string[]): string {
  const roleList = roles.map(quoteLiteral).join(", ");
  return `SELECT json_build_object(
  'serverVersionNum', current_setting('server_version_num')::int,
  'database', current_database(),
  'sessionUser', session_user::text,
  'currentUser', current_user::text,
  'adminCanCreateRoles', (SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user),
  'existingRuntimeRoles', COALESCE((SELECT json_agg(rolname ORDER BY rolname) FROM pg_roles WHERE rolname IN (${roleList})), '[]'::json),
  'privateSchemaExists', EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${quoteLiteral(PRIVATE_SCHEMA)}),
  'nonPublicUserSchemas', COALESCE((SELECT json_agg(n.nspname ORDER BY n.nspname) FROM pg_namespace n WHERE ${SYSTEM_SCHEMA_FILTER} AND n.nspname <> 'public'), '[]'::json),
  'publicRelations', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace),
  'publicFunctions', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
  'publicTypes', (SELECT count(*) FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace),
  'defaultAclEntries', (SELECT count(*) FROM pg_default_acl)
);`;
}

/** Objects of every kind that live in one schema. Any non-zero count means "not empty". */
export function schemaObjectCountsSql(schema: string): string {
  const ns = `(SELECT oid FROM pg_namespace WHERE nspname = ${quoteLiteral(schema)})`;
  return `SELECT json_build_object(
  'schemaExists', EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${quoteLiteral(schema)}),
  'owner', (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = ${quoteLiteral(schema)}),
  'tables', (SELECT count(*) FROM pg_class WHERE relnamespace = ${ns} AND relkind IN ('r', 'p')),
  'sequences', (SELECT count(*) FROM pg_class WHERE relnamespace = ${ns} AND relkind = 'S'),
  'views', (SELECT count(*) FROM pg_class WHERE relnamespace = ${ns} AND relkind IN ('v', 'm')),
  'indexes', (SELECT count(*) FROM pg_class WHERE relnamespace = ${ns} AND relkind IN ('i', 'I')),
  'otherRelations', (SELECT count(*) FROM pg_class WHERE relnamespace = ${ns} AND relkind NOT IN ('r', 'p', 'S', 'v', 'm', 'i', 'I')),
  'functions', (SELECT count(*) FROM pg_proc WHERE pronamespace = ${ns}),
  'types', (SELECT count(*) FROM pg_type WHERE typnamespace = ${ns}),
  'collations', (SELECT count(*) FROM pg_collation WHERE collnamespace = ${ns}),
  'operators', (SELECT count(*) FROM pg_operator WHERE oprnamespace = ${ns}),
  'conversions', (SELECT count(*) FROM pg_conversion WHERE connamespace = ${ns}),
  'textSearch', (SELECT count(*) FROM pg_ts_config WHERE cfgnamespace = ${ns}) + (SELECT count(*) FROM pg_ts_dict WHERE dictnamespace = ${ns}),
  'extensions', (SELECT count(*) FROM pg_extension WHERE extnamespace = ${ns}),
  'statisticsObjects', (SELECT count(*) FROM pg_statistic_ext WHERE stxnamespace = ${ns})
);`;
}

export type SchemaObjectCounts = {
  schemaExists: boolean;
  owner: string | null;
  tables: number;
  sequences: number;
  views: number;
  indexes: number;
  otherRelations: number;
  functions: number;
  types: number;
  collations: number;
  operators: number;
  conversions: number;
  textSearch: number;
  extensions: number;
  statisticsObjects: number;
};

export function isEmptySchema(counts: SchemaObjectCounts): boolean {
  const { schemaExists: _exists, owner: _owner, ...objects } = counts;
  return Object.values(objects).every((count) => count === 0);
}

const ROLE_ATTRIBUTES = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 16`;

/** Restricted public runtime role with exactly the reviewed table and column grants. */
export function createPublicRoleSql(role: string, password: string): string {
  const ident = quoteIdent(role);
  const statements = [
    `CREATE ROLE ${ident} ${ROLE_ATTRIBUTES} PASSWORD ${quoteLiteral(password)};`,
    `GRANT USAGE ON SCHEMA public TO ${ident};`,
  ];
  for (const grant of PUBLIC_TABLE_GRANTS) {
    statements.push(
      `GRANT ${grant.privileges.join(", ")} ON TABLE ${publicTable(grant.table)} TO ${ident};`,
    );
  }
  for (const grant of PUBLIC_COLUMN_UPDATE_GRANTS) {
    statements.push(
      `GRANT UPDATE (${grant.columns.map(column).join(", ")}) ON TABLE ${publicTable(grant.table)} TO ${ident};`,
    );
  }
  return statements.join("\n");
}

/**
 * Empty private schema owned by the bootstrap role and the private runtime role with USAGE only.
 * No tables, no default privileges, no CREATE: later migrations use a separate privileged path.
 */
export function provisionPrivateSql(
  adminRole: string,
  privateRole: string,
  password: string,
): string {
  const schema = quoteIdent(PRIVATE_SCHEMA);
  const ident = quoteIdent(privateRole);
  return `CREATE SCHEMA ${schema} AUTHORIZATION ${quoteIdent(adminRole)};
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
CREATE ROLE ${ident} ${ROLE_ATTRIBUTES} PASSWORD ${quoteLiteral(password)};
GRANT USAGE ON SCHEMA ${schema} TO ${ident};`;
}

/** Column privileges PostgreSQL can grant per column; DELETE/TRUNCATE/TRIGGER are table-only. */
export const COLUMN_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "REFERENCES"] as const;

/**
 * Effective column privileges of `roleExpression` on public relations that its table-level
 * privileges do not already imply. `has_table_privilege` misses column-only grants, and reading
 * `attacl` for the role's own grantee would miss grants to `PUBLIC` or inherited from a role, so
 * this asks `has_column_privilege` (which applies both) for every column and privilege.
 */
export function columnPrivilegesSql(roleExpression: string): string {
  return `COALESCE((SELECT json_agg(json_build_array(c.relname, a.attname, p.privilege) ORDER BY c.relname, a.attname, p.privilege)
    FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN unnest(ARRAY[${COLUMN_PRIVILEGES.map((privilege) => `'${privilege}'`).join(",")}]) AS p(privilege)
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND has_column_privilege(${roleExpression}, c.oid, a.attnum, p.privilege)
      AND NOT has_table_privilege(${roleExpression}, c.oid, p.privilege)), '[]'::json)`;
}

/** Effective table-level privileges of `roleExpression` (direct, `PUBLIC` or inherited). */
export function tablePrivilegesSql(roleExpression: string): string {
  return `COALESCE((SELECT json_agg(json_build_array(c.relname, p.privilege) ORDER BY c.relname, p.privilege)
    FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(privilege)
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND has_table_privilege(${roleExpression}, c.oid, p.privilege)), '[]'::json)`;
}

/** Admin view of grants that must be identical before and after private provisioning. */
export function publicGrantSnapshotSql(publicRole: string): string {
  const role = quoteLiteral(publicRole);
  return `SELECT json_build_object(
  'tablePrivileges', ${tablePrivilegesSql(role)},
  'columnPrivileges', ${columnPrivilegesSql(role)},
  'publicSchemaUsage', has_schema_privilege(${role}, 'public', 'USAGE'),
  'publicSchemaCreate', has_schema_privilege(${role}, 'public', 'CREATE'),
  'publicSchemaAcl', (SELECT nspacl::text FROM pg_namespace WHERE nspname = 'public')
);`;
}

/** Inventory of run-created public objects (the preflight proved the public schema was empty). */
export const PUBLIC_OBJECT_INVENTORY_SQL = `SELECT json_build_object(
  'tables', COALESCE((SELECT json_agg(relname ORDER BY relname) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')), '[]'::json),
  'functions', COALESCE((SELECT json_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace), '[]'::json)
);`;

export type PublicObjectInventory = { tables: string[]; functions: string[] };

/** Drop only objects recorded as created by this run. CASCADE reaches dependents of those objects. */
export function dropRecordedPublicObjectsSql(inventory: PublicObjectInventory): string {
  const statements: string[] = [];
  for (const table of inventory.tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(table)) throw new Error("Unexpected table name");
    statements.push(`DROP TABLE IF EXISTS public."${table}" CASCADE;`);
  }
  for (const fn of inventory.functions) {
    // regprocedure text such as oratlas_protect_verification() or "Name"(text, integer).
    if (!/^(?:public\.)?(?:"[A-Za-z0-9_]+"|[a-z_][a-z0-9_]*)\([a-z0-9_ ,"[\]]*\)$/u.test(fn)) {
      throw new Error("Unexpected function signature");
    }
    statements.push(`DROP FUNCTION IF EXISTS ${fn.startsWith("public.") ? fn : `public.${fn}`};`);
  }
  return statements.join("\n");
}

/**
 * Identity and object facts the admin connection re-checks immediately before every reset: the
 * reset may only touch the exact run-created inventory in the validated database.
 */
export const RESET_TARGET_SQL = `SELECT json_build_object(
  'database', current_database(),
  'sessionUser', session_user::text,
  'currentUser', current_user::text,
  'inventory', json_build_object(
    'tables', COALESCE((SELECT json_agg(relname ORDER BY relname) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')), '[]'::json),
    'functions', COALESCE((SELECT json_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace), '[]'::json))
);`;

export type ResetTarget = {
  database: string;
  sessionUser: string;
  currentUser: string;
  inventory: PublicObjectInventory;
};

/** Problems that forbid a reset (empty when the target is exactly the recorded run target). */
export function resetTargetProblems(
  facts: ResetTarget,
  expected: { database: string; adminRole: string; inventory: PublicObjectInventory },
): string[] {
  const problems: string[] = [];
  if (facts.database !== expected.database) problems.push("reset connection database differs");
  if (facts.sessionUser !== expected.adminRole || facts.currentUser !== expected.adminRole) {
    problems.push("reset connection identity differs from the bootstrap role");
  }
  if (JSON.stringify(facts.inventory) !== JSON.stringify(expected.inventory)) {
    problems.push("public objects differ from the run-created inventory");
  }
  return problems;
}

/**
 * Truncate exactly the run-created public tables (no CASCADE: a reference from any other table
 * fails the reset) so the fixture file can be reloaded in the same transaction.
 */
export function truncateRecordedPublicTablesSql(inventory: PublicObjectInventory): string {
  if (inventory.tables.length === 0) throw new Error("Empty public inventory");
  return `TRUNCATE TABLE ${inventory.tables.map(publicTable).join(", ")} RESTART IDENTITY;`;
}

/**
 * Mutable fixture state after a reset: row counts of every granted table plus the columns the
 * scenarios mutate. Must equal `EXPECTED_RESET_STATE` before each capture child starts.
 */
export function resetStateSql(): string {
  const counts = PUBLIC_SELECT_TABLES.map(
    (table) => `'${table}', (SELECT count(*) FROM ${publicTable(table)})`,
  ).join(", ");
  return `SELECT json_build_object(
  'counts', json_build_object(${counts}),
  'users', (SELECT json_agg(json_build_array("id", "orcid", "orcidVerifiedAt" IS NOT NULL) ORDER BY "id" COLLATE "C") FROM public."User"),
  'unreadNotifications', (SELECT count(*) FROM public."Notification" WHERE "readAt" IS NULL),
  'certifiers', (SELECT json_agg(json_build_array("id", "status") ORDER BY "id" COLLATE "C") FROM public."Certifier")
);`;
}

export type ResetState = {
  counts: Record<string, number>;
  users: Array<[string, string | null, boolean]>;
  unreadNotifications: number;
  certifiers: Array<[string, string]>;
};

/** Seed state of fixtures/public-fixtures.sql (reviewed with the fixture file). */
export const EXPECTED_RESET_STATE: ResetState = {
  counts: {
    AuditEvent: 0,
    CertificationProtocol: 1,
    Certifier: 2,
    Citation: 1,
    Claim: 3,
    ClaimEvidenceRelation: 1,
    KnowledgeNode: 4,
    KnowledgeNodeVersion: 4,
    NodeAlias: 0,
    NodeEdge: 3,
    Notification: 6,
    Person: 2,
    Publication: 1,
    PublicationCapture: 0,
    PublicationClaimOccurrence: 0,
    PublicationVersion: 1,
    Repository: 3,
    RepositorySnapshot: 4,
    Review: 3,
    ReviewContributor: 5,
    ReviewLifecycleEvent: 3,
    ReviewVersion: 4,
    Submission: 0,
    SynthesisDraft: 0,
    TrustAssessment: 0,
    TrustVerification: 0,
    User: 5,
  },
  users: [
    ["g1-user-a-and-b", "0000-0000-0000-0003", false],
    ["g1-user-a-only", "0000-0000-0000-0001", true],
    ["g1-user-admin", "0000-0000-0000-0005", false],
    ["g1-user-b-only", "0000-0000-0000-0002", false],
    ["g1-user-editor", "0000-0000-0000-0004", false],
  ],
  unreadNotifications: 6,
  certifiers: [
    ["g1-certifier-1", "active"],
    ["g1-certifier-ora", "active"],
  ],
};

/** Drop a runtime role this run proved it created; DROP OWNED also revokes its grants here. */
export function dropRoleSql(role: string): string {
  const ident = quoteIdent(role);
  return `DROP OWNED BY ${ident};
DROP ROLE ${ident};`;
}

export function dropPrivateSchemaSql(): string {
  // RESTRICT (the default): fails rather than deleting anything if the schema is not empty.
  return `DROP SCHEMA ${quoteIdent(PRIVATE_SCHEMA)} RESTRICT;`;
}

/** Posture of the connected role as seen from its own session (no admin involvement). */
export function rolePostureSql(otherRoles: readonly string[]): string {
  const others = otherRoles
    .map(
      (role) =>
        `json_build_object('role', ${quoteLiteral(role)}, 'exists', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(role)}),` +
        ` 'member', CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(role)}) THEN pg_has_role(session_user, ${quoteLiteral(role)}, 'MEMBER') END,` +
        ` 'usage', CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(role)}) THEN pg_has_role(session_user, ${quoteLiteral(role)}, 'USAGE') END)`,
    )
    .join(", ");
  const schema = quoteLiteral(PRIVATE_SCHEMA);
  return `SELECT json_build_object(
  'sessionUser', session_user::text,
  'currentUser', current_user::text,
  'database', current_database(),
  'attributes', (SELECT json_build_object('super', rolsuper, 'inherit', rolinherit, 'createRole', rolcreaterole,
      'createDb', rolcreatedb, 'replication', rolreplication, 'bypassRls', rolbypassrls, 'canLogin', rolcanlogin)
    FROM pg_roles WHERE rolname = session_user),
  'memberOf', COALESCE((SELECT json_agg(b.rolname ORDER BY b.rolname) FROM pg_auth_members m
    JOIN pg_roles b ON b.oid = m.roleid JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = session_user), '[]'::json),
  'members', COALESCE((SELECT json_agg(r.rolname ORDER BY r.rolname) FROM pg_auth_members m
    JOIN pg_roles b ON b.oid = m.roleid JOIN pg_roles r ON r.oid = m.member WHERE b.rolname = session_user), '[]'::json),
  'otherRoles', json_build_array(${others}),
  'owned', json_build_object(
    'relations', (SELECT count(*) FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = session_user)),
    'schemas', (SELECT count(*) FROM pg_namespace WHERE nspowner = (SELECT oid FROM pg_roles WHERE rolname = session_user)),
    'functions', (SELECT count(*) FROM pg_proc WHERE proowner = (SELECT oid FROM pg_roles WHERE rolname = session_user)),
    'types', (SELECT count(*) FROM pg_type WHERE typowner = (SELECT oid FROM pg_roles WHERE rolname = session_user)),
    'databases', (SELECT count(*) FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = session_user))),
  'privateSchema', json_build_object(
    'visibleInCatalog', EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${schema}),
    'owner', (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = ${schema}),
    'usage', has_schema_privilege(session_user, ${schema}, 'USAGE'),
    'create', has_schema_privilege(session_user, ${schema}, 'CREATE'),
    'acl', COALESCE((SELECT json_agg(json_build_object('grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
        'privilege', a.privilege_type, 'grantable', a.is_grantable) ORDER BY 1)
      FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname = ${schema}), '[]'::json)),
  'publicSchema', json_build_object(
    'usage', has_schema_privilege(session_user, 'public', 'USAGE'),
    'create', has_schema_privilege(session_user, 'public', 'CREATE')),
  'databasePrivileges', json_build_object(
    'create', has_database_privilege(session_user, current_database(), 'CREATE'),
    'temporary', has_database_privilege(session_user, current_database(), 'TEMPORARY'),
    'connect', has_database_privilege(session_user, current_database(), 'CONNECT')),
  'publicTablePrivileges', ${tablePrivilegesSql("session_user")},
  'publicColumnPrivileges', ${columnPrivilegesSql("session_user")},
  'defaultAcl', COALESCE((SELECT json_agg(json_build_object('role', pg_get_userbyid(d.defaclrole),
      'schema', CASE WHEN d.defaclnamespace = 0 THEN NULL ELSE d.defaclnamespace::regnamespace::text END,
      'objectType', d.defaclobjtype, 'acl', d.defaclacl::text)) FROM pg_default_acl d), '[]'::json)
);`;
}

export type ProbeResult = {
  sqlstate: string;
  message: string | null;
  sessionUser: string;
  currentUserAfter: string;
};

/**
 * Execute one statement inside a transaction that is always rolled back, recording the SQLSTATE
 * (or SUCCEEDED). The statement is a reviewed constant; it is embedded as a quoted literal.
 */
export function probeSql(statement: string): string {
  return `BEGIN;
DO $g1probe$
BEGIN
  BEGIN
    EXECUTE ${quoteLiteral(statement)};
    PERFORM set_config('g1.probe_state', 'SUCCEEDED', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('g1.probe_state', SQLSTATE, true);
    PERFORM set_config('g1.probe_message', SQLERRM, true);
  END;
END
$g1probe$;
SELECT json_build_object('sqlstate', current_setting('g1.probe_state'),
  'message', NULLIF(current_setting('g1.probe_message', true), ''),
  'sessionUser', session_user::text, 'currentUserAfter', current_user::text);
ROLLBACK;`;
}
