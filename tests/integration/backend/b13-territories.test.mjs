import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { importAbaiTerritories } from '../../../scripts/import-abai-territories.mjs';
import { buildCatalogSnapshot, routePrepared, loadRoutingEngine } from '../../../src/server/routing/adapter.mjs';

test('Abai localities preserve legacy IDs, saved ideas and regional routing on repeated import', async () => {
  const db = await openDatabase({databaseUrl:undefined,pgliteDir:undefined});
  try {
    await migrate(db);
    await seed(db,{demoPassword:'territory-test-password'});
    const semey = (await db.query("SELECT id,region_id FROM territories WHERE code='DEMO_SEMEY'")).rows[0];
    const citizen = (await db.query("SELECT id FROM users WHERE role='CITIZEN' LIMIT 1")).rows[0];
    const idea = (await db.query(`INSERT INTO ideas(region_id,author_id,territory_id,title) VALUES($1,$2,$3,'Существующая идея') RETURNING id`,[semey.region_id,citizen.id,semey.id])).rows[0];
    assert.equal((await importAbaiTerritories(db)).localities,326);
    const first = (await db.query("SELECT id,code FROM territories WHERE code LIKE 'KATO_%' OR code='DEMO_SEMEY' ORDER BY code")).rows;
    await importAbaiTerritories(db);
    assert.deepEqual((await db.query("SELECT id,code FROM territories WHERE code LIKE 'KATO_%' OR code='DEMO_SEMEY' ORDER BY code")).rows,first);
    const saved = (await db.query('SELECT territory_id,title FROM ideas WHERE id=$1',[idea.id])).rows[0];
    assert.equal(saved.territory_id,semey.id);
    assert.equal(saved.title,'Существующая идея');
    const cities = (await db.query("SELECT name_ru FROM territories WHERE kind='CITY' ORDER BY name_ru")).rows.map(t=>t.name_ru);
    assert.deepEqual(cities,['Аягоз','Курчатов','Семей','Шар']);
    const snapshot = await buildCatalogSnapshot(db,semey.region_id);
    const route = routePrepared(await loadRoutingEngine(),{title:'Автобусное сообщение в Курчатове',problem:'Недостаточно автобусных маршрутов и остановок',solution:'Добавить автобусные маршруты и остановки',requestedCategoryCode:'TRANSPORT',territoryCode:'KATO_101810000'},snapshot,null);
    assert.ok(route.organizationCode);
    const kurchatov = (await db.query("SELECT id FROM territories WHERE code='KATO_101810000'")).rows[0];
    await db.query('UPDATE ideas SET territory_id=$1 WHERE id=$2',[kurchatov.id,idea.id]);
    assert.equal((await db.query('SELECT territory_id FROM ideas WHERE id=$1',[idea.id])).rows[0].territory_id,kurchatov.id);
  } finally { await db.close(); }
});
