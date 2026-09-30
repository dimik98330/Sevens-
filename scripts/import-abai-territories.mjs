import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseEnv } from 'node:util';
import catalog from '../src/domain/territories/abai.json' with { type: 'json' };
import { openDatabase } from '../src/server/db/client.mjs';

// Adds verified public geography only. Existing primary keys, ideas, users,
// assignments and routing rules are preserved, including legacy Semey IDs.
export async function importAbaiTerritories(db) {
  return db.transaction(async tx => {
    const region = await tx.query(`INSERT INTO regions(id,code,name_ru,name_kk,active)
      VALUES($1,'ABAI','Область Абай','Абай облысы',TRUE)
      ON CONFLICT(code) DO UPDATE SET name_kk=EXCLUDED.name_kk RETURNING id`, [catalog.regionId]);
    const regionId = region.rows[0].id;
    const all = [...catalog.districts, ...catalog.territories];
    const conflicts = await tx.query('SELECT code FROM territories WHERE code=ANY($1::text[]) AND region_id<>$2', [all.map(t => t.code), regionId]);
    if (conflicts.rows.length) throw new Error('Territory codes belong to a different region; import rolled back');
    async function upsert(items, parents = new Map()) {
      const params = [];
      const values = items.map(t => {
        const offset = params.length;
        params.push(t.id,regionId,parents.get(t.districtCode) ?? null,t.code,t.kind,t.nameRu,t.nameKk);
        return `(${Array.from({length:7},(_,i)=>'$'+(offset+i+1)).join(',')},TRUE,FALSE)`;
      });
      return (await tx.query(`INSERT INTO territories(id,region_id,parent_id,code,kind,name_ru,name_kk,active,is_demo)
        VALUES ${values.join(',')} ON CONFLICT(code) DO UPDATE SET
        parent_id=EXCLUDED.parent_id,kind=EXCLUDED.kind,name_ru=EXCLUDED.name_ru,
        name_kk=EXCLUDED.name_kk,active=TRUE,is_demo=FALSE RETURNING id,code`, params)).rows;
    }
    const districts = await upsert(catalog.districts);
    const territories = await upsert(catalog.territories, new Map(districts.map(t => [t.code,t.id])));
    return { localities: territories.length, administrativeGroups: districts.length, sourceDate: catalog.source.updatedAt };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync('.env.sevens')) Object.assign(process.env,parseEnv(readFileSync('.env.sevens','utf8')));
  const db = await openDatabase();
  try {
    mkdirSync('.data/territories',{recursive:true});
    const previous = await db.query(`SELECT t.* FROM territories t JOIN regions r ON r.id=t.region_id WHERE r.code='ABAI'`);
    if (!existsSync('.data/territories/catalog-before-import.json')) writeFileSync('.data/territories/catalog-before-import.json',JSON.stringify(previous.rows,null,2)+'\n');
    console.log(JSON.stringify(await importAbaiTerritories(db)));
  } finally { await db.close(); }
}
