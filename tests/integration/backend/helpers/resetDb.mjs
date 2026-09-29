// Test-only helper: wipe every table in the public schema so each backend
// test file starts from an empty database, whether it runs on PGlite or on
// a shared real PostgreSQL. Table names are discovered from the catalog, so
// the helper cannot rot when migrations add tables. Shared-database runs
// must additionally use --test-concurrency=1 (node runs test files in
// parallel otherwise, and files would wipe each other mid-flight).
export async function resetDb(db) {
  const r = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`);
  const tables = r.rows.map((x) => x.tablename);
  if (tables.length === 0) return;
  const quoted = tables.map((t) => `"${t.replace(/"/g, '""')}"`).join(', ');
  await db.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
}
