// Test-only helper. Every suite explicitly opens in-memory PGlite; refuse any
// PostgreSQL connection so a developer's DATABASE_URL can never be truncated.
// Table names are discovered from the catalog as migrations evolve.
export async function resetDb(db) {
  if (db.kind !== 'pglite') {
    throw new Error('Test reset is allowed only on isolated PGlite');
  }
  const r = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`);
  const tables = r.rows.map((x) => x.tablename);
  if (tables.length === 0) return;
  const quoted = tables.map((t) => `"${t.replace(/"/g, '""')}"`).join(', ');
  await db.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
}
