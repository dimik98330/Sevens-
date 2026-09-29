// B-owned adapter over D's routing engine (src/domain/routing, D-01).
// B never reimplements classification: the engine is loaded from D's own
// TypeScript sources via transpile (devDependency `typescript`) and used as
// the single implementation. D remains the owner of all routing logic.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

let cached = null;

export async function loadRoutingEngine(repoRoot = process.cwd()) {
  if (cached) return cached;
  const ts = require('typescript');
  const dir = path.join(repoRoot, 'src', 'domain', 'routing');
  const outDir = mkdtempSync(path.join(tmpdir(), 'routing-engine-'));
  for (const name of ['types.ts', 'normalize.ts', 'features.ts', 'rules.ts']) {
    const source = readFileSync(path.join(dir, name), 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    });
    // Node ESM needs explicit extensions; D's sources may use extensionless
    // relative imports, so map './x' -> './x.js' (existing extensions kept).
    const fixed = compiled.outputText.replace(
      /(from\s*|import\s*\()\s*(['"])(\.[^'"]*)\2/g,
      (m, prefix, quote, spec) => {
        const withExt = /\.[a-z]+$/i.test(spec) ? spec : spec + '.js';
        return `${prefix}${quote}${withExt}${quote}`;
      });
    writeFileSync(path.join(outDir, name.replace(/\.ts$/, '.js')), fixed);
  }
  const rules = await import(pathToFileURL(path.join(outDir, 'rules.js')).href);
  cached = {
    routeIdea: rules.routeIdea,
    manualReroute: rules.manualReroute,
    confidenceLabel: rules.confidenceLabel,
  };
  return cached;
}

// Catalog snapshot for routeIdea, built from the current DB state (B-owned).
export async function buildCatalogSnapshot(db, regionId) {
  const territories = await db.query(
    `SELECT code, active FROM territories WHERE region_id=$1`, [regionId]);
  const orgs = await db.query(
    `SELECT code, name, active, is_triage AS "isTriage" FROM organizations WHERE region_id=$1`,
    [regionId]);
  const rules = await db.query(
    `SELECT r.category_code AS "categoryCode",
            (SELECT code FROM organizations o WHERE o.id=r.organization_id) AS "organizationCode",
            (SELECT code FROM territories t WHERE t.id=r.territory_id) AS "territoryCode",
            r.priority, r.active
     FROM routing_rules r WHERE r.region_id=$1 AND r.version='rules-v1'`,
    [regionId]);
  return {
    ruleVersion: 'rules-v1',
    territories: territories.rows,
    organizations: orgs.rows,
    rules: rules.rows.map((r) => ({ ...r, territoryCode: r.territoryCode })),
  };
}
