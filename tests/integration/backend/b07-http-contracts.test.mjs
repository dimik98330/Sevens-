import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { createServer } from '../../../src/server/http/app.mjs';
import { calendarDay } from '../../../src/server/http/query.mjs';

const origin = 'http://localhost:3000';
const password = 'b07-synthetic-password-12';
const proxySecret = 'b07-only-synthetic-proxy-secret-123456';
let db, server, base, uploads, citizen, territoryId, staff;
const fields = { title: 'Умные светофоры для безопасной дороги',
  problem: 'У школы дорога и светофоры не учитывают загруженность дороги и безопасность детей.',
  solution: 'Установить умные светофоры и датчики загруженности дороги возле школы.',
  requestedCategoryCode: null };

async function request(method, url, { auth, body, key, headers = {}, raw } = {}) {
  const response = await fetch(base + url, { method, headers: {
    origin, ...(auth ? { cookie: auth.cookie, 'x-csrf-token': auth.csrf } : {}),
    ...(key ? { 'idempotency-key': key } : {}),
    ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers,
  }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const json = response.status === 204 ? null : await response.json();
  return { status: response.status, json, headers: response.headers };
}
async function login(email) {
  const response = await request('POST','/api/v1/auth/login',{ body: { email, password } });
  assert.equal(response.status,200,JSON.stringify(response.json));
  return { cookie: response.headers.get('set-cookie').split(';')[0],
    csrf: response.json.data.csrfToken, user: response.json.data.user };
}
before(async () => {
  db = await openDatabase({ databaseUrl:null,pgliteDir:null });
  await migrate(db); await seed(db,{ demoPassword:password });
  uploads = await mkdtemp(path.join(tmpdir(),'b07-uploads-'));
  server = createServer(db,{ origin,secureCookies:false,uploadDir:uploads,proxySecret });
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  territoryId = (await db.query("SELECT id FROM territories WHERE code='DEMO_SEMEY'")).rows[0].id;
  citizen = await login('citizen1@example.test'); staff = await login('transport@example.test');
});
after(async () => {
  await new Promise((resolve) => server.close(resolve)); await db.close();
  await rm(uploads,{ recursive:true,force:true });
});

it('me is stable across tabs and overlapping mutations', async () => {
  const [first,second] = await Promise.all([
    request('GET','/api/v1/auth/me',{ auth:citizen }), request('GET','/api/v1/auth/me',{ auth:citizen }),
  ]);
  assert.equal(first.json.data.csrfToken,citizen.csrf);
  assert.equal(second.json.data.csrfToken,citizen.csrf);
  const [me,created] = await Promise.all([
    request('GET','/api/v1/auth/me',{ auth:citizen }),
    request('POST','/api/v1/ideas',{ auth:citizen,key:randomUUID(),body:{} }),
  ]);
  assert.equal(me.status,200); assert.equal(created.status,201);
});

it('strict bodies and query filters return 400 with fields/requestId', async () => {
  for (const body of [null,[],{ role:'ADMIN' },{ territoryId:'not-a-uuid' }]) {
    const result = await request('POST','/api/v1/ideas',{ auth:citizen,key:randomUUID(),body });
    assert.equal(result.status,400); assert.equal(result.json.error.code,'VALIDATION_ERROR');
    assert.ok(result.json.meta.requestId); assert.ok(result.json.error.fields);
  }
  for (const query of ['page=1.5','pageSize=101','status=BAD','category=BAD',
    'dateFrom=2026-02-30','dateTo=not-a-date','assignee=bad','dir=drop','sort=password']) {
    const result = await request('GET',`/api/v1/ideas?scope=staff&${query}`,{ auth:staff });
    assert.equal(result.status,400,query); assert.ok(result.json.error.fields);
  }
  const huge = await request('POST','/api/v1/ideas',{ auth:citizen,key:randomUUID(),
    raw:JSON.stringify({ title:'x'.repeat(70_000) }) });
  assert.equal(huge.status,413); assert.equal(huge.json.error.code,'FILE_TOO_LARGE');
});

it('server preview uses the live catalog and never creates an idea', async () => {
  const beforeCount = (await db.query('SELECT count(*)::int AS n FROM ideas')).rows[0].n;
  const result = await request('POST','/api/v1/ideas/routing-preview',{
    auth:citizen,body:{ ...fields,territoryId } });
  assert.equal(result.status,200); assert.equal(result.json.meta.preview,true);
  assert.equal(result.json.data.effectiveCategoryCode,'TRANSPORT');
  assert.equal(result.json.data.organizationCode,'DEMO_TRANSPORT');
  assert.ok(result.json.data.explanation); assert.ok(result.json.data.tags.includes('SMART_CITY'));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ideas')).rows[0].n,beforeCount);
  const denied = await request('POST','/api/v1/ideas/routing-preview',{ auth:staff,body:{...fields,territoryId} });
  assert.equal(denied.status,403);
});

it('notifications report the entire unread count beyond a page and read is idempotent', async () => {
  const draft = await request('POST','/api/v1/ideas',{auth:citizen,key:randomUUID(),body:{...fields,territoryId}});
  const id = draft.json.data.id;
  for (let n=0;n<25;n++) {
    const event = await db.query("INSERT INTO idea_events(idea_id,type,actor_id,visibility) VALUES($1,'COMMENT_PUBLIC',$2,'PUBLIC') RETURNING id",[id,citizen.user.id]);
    await db.query("INSERT INTO notifications(recipient_id,idea_id,source_event_id,kind,title) VALUES($1,$2,$3,'PUBLIC_REPLY',$4)",[citizen.user.id,id,event.rows[0].id,`Test notice ${n}`]);
  }
  const list = await request('GET','/api/v1/notifications?pageSize=5',{auth:citizen});
  assert.equal(list.json.data.length,5); assert.ok(list.json.meta.unreadCount>=25);
  const count = list.json.meta.unreadCount;
  const notificationId = list.json.data[0].id;
  for (let n=0;n<2;n++) assert.equal((await request('POST',`/api/v1/notifications/${notificationId}/read`,{auth:citizen,body:{}})).status,204);
  assert.equal((await request('GET','/api/v1/notifications?unreadOnly=true&pageSize=1',{auth:citizen})).json.meta.unreadCount,count-1);
});

it('analytics has the same scoped filtered population as the queue', async () => {
  const created = await request('POST','/api/v1/ideas',{auth:citizen,key:randomUUID(),body:{...fields,territoryId}});
  const id = created.json.data.id;
  const submitted = await request('POST',`/api/v1/ideas/${id}/submit`,{auth:citizen,key:randomUUID(),body:{expectedVersion:1,consentAccepted:true}});
  assert.equal(submitted.status,200,JSON.stringify(submitted.json));
  const query = `q=${encodeURIComponent(submitted.json.data.publicNumber)}`;
  const queue = await request('GET',`/api/v1/ideas?scope=staff&${query}`,{auth:staff});
  const analytics = await request('GET',`/api/v1/analytics/summary?${query}`,{auth:staff});
  assert.equal(analytics.status,200,JSON.stringify(analytics.json));
  assert.equal(queue.json.meta.total,analytics.json.data.total); assert.equal(analytics.json.data.total,1);
  assert.equal(analytics.json.data.byCategory.TRANSPORT,1); assert.equal(analytics.json.data.byStatus.RECEIVED,1);
  assert.equal(analytics.json.data.medianFirstReviewSeconds,null);
  assert.equal((await request('GET','/api/v1/analytics/summary',{auth:citizen})).status,403);
});

it('trusted proxy identities have separate registration quotas and cannot be unsigned', async () => {
  const signed = { 'x-abai-proxy-key':proxySecret,'x-abai-client-ip':'192.0.2.10' };
  for (let n=0;n<20;n++) assert.equal((await request('POST','/api/v1/auth/register',{headers:signed,body:{}})).status,400);
  const limited = await request('POST','/api/v1/auth/register',{headers:signed,body:{}});
  assert.equal(limited.status,429); assert.ok(Number(limited.headers.get('retry-after'))>0);
  const different = await request('POST','/api/v1/auth/register',{
    headers:{...signed,'x-abai-client-ip':'192.0.2.11'},body:{displayName:'Proxy test',email:'b07-proxy@example.test',password,consentAccepted:true} });
  assert.equal(different.status,201);
  const unsigned = await request('POST','/api/v1/auth/register',{
    headers:{'x-abai-client-ip':'192.0.2.10'},body:{} });
  assert.equal(unsigned.status,400);
});

it('calendar filters include the complete local day', () => {
  assert.deepEqual(calendarDay('2026-09-30','dateFrom'),{
    start:'2026-09-29T19:00:00.000Z',next:'2026-09-30T19:00:00.000Z' });
});

it('reroute without a category preserves the locked current category and moves access', async () => {
  const admin=await login('admin@example.test');
  const utilities=await login('utilities@example.test');
  const created=await request('POST','/api/v1/ideas',{auth:citizen,key:randomUUID(),body:{...fields,territoryId}});
  const id=created.json.data.id;
  const submitted=await request('POST',`/api/v1/ideas/${id}/submit`,{auth:citizen,key:randomUUID(),body:{expectedVersion:1,consentAccepted:true}});
  assert.equal(submitted.status,200);
  const organizations=await request('GET','/api/v1/admin/organizations',{auth:admin});
  const org=organizations.json.data.find((item)=>item.code==='DEMO_UTILITIES');
  const result=await request('POST',`/api/v1/admin/ideas/${id}/reroute`,{auth:admin,key:randomUUID(),
    body:{expectedVersion:submitted.json.data.version,organizationId:org.id,reason:'Нужна совместная проверка цифровой инфраструктуры специалистом.'}});
  assert.equal(result.status,200,JSON.stringify(result.json));
  assert.equal(result.json.data.effectiveCategoryCode,'TRANSPORT');
  assert.equal((await request('GET',`/api/v1/ideas/${id}`,{auth:staff})).status,404);
  assert.equal((await request('GET',`/api/v1/ideas/${id}`,{auth:utilities})).status,200);
});

it('readiness refuses a missing required geometry migration', async () => {
  const row=(await db.query("SELECT * FROM schema_migrations WHERE version='0004_location_geometry.sql'")).rows[0];
  try {
    await db.query('DELETE FROM schema_migrations WHERE version=$1',[row.version]);
    assert.equal((await request('GET','/api/health/ready')).status,503);
  } finally {
    await db.query('INSERT INTO schema_migrations(version,applied_at) VALUES($1,$2)',[row.version,row.applied_at]);
  }
  assert.equal((await request('GET','/api/health/ready')).status,200);
});
