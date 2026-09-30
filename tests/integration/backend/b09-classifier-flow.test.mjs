// Complete classifier/API spine with memory-only PostgreSQL and an injected
// fake provider. Never contacts a paid API, loads a model or resets a live DB.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { createServer } from '../../../src/server/http/app.mjs';
import { createSemanticClassifier } from '../../../src/server/routing/semantic.mjs';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'b09-only-synthetic-password-12';
const TRANSPORT = {
  title: 'Умные светофоры у школы',
  problem: 'Нет светофора возле школы, детям трудно перейти дорогу в часы пик.',
  solution: 'Установить умные светофоры и датчики загруженности дороги возле школы.',
};
const UTILITIES = {
  title: 'Датчики утечки воды в водопроводе',
  problem: 'Водопровод часто даёт утечки, жители теряют воду и долго ждут ремонт труб.',
  solution: 'Установить датчики утечки воды и передавать сигналы диспетчеру ЖКХ.',
};

function answer(input, category = 'TRANSPORT') {
  return { detectedCategoryCode: category, secondaryCategories: [], confidenceBand: 'HIGH',
    needsReview: false, digitalComponent: true,
    explanation: category === 'TRANSPORT' ? 'Предлагается установить умные светофоры на дороге возле школы.'
      : 'Предлагаются датчики утечки воды для водопроводной сети ЖКХ.',
    evidence: [{ field: 'solution', quote: input.solution.slice(0, 45), kind: 'SUPPORT' }] };
}

async function fixture(provider, classifierOptions = {}) {
  const db = await openDatabase({ databaseUrl: null, pgliteDir: null });
  let server;
  let uploadDir;
  let transactionDepth = 0;
  let providerCalls = 0;
  const classifier = createSemanticClassifier({ enabled: true, apiKey: 'b09-test-only-not-a-real-key', model: 'b09-fake-model',
    mode: 'hybrid', localEnabled: false, maxConcurrent: 1, ...classifierOptions,
    ...(classifierOptions.localProvider ? { localProvider: async (input) => {
      assert.equal(transactionDepth, 0, 'local model must also run outside SQL transactions');
      return classifierOptions.localProvider(input);
    } } : {}),
    provider: async (context) => {
      providerCalls++;
      assert.equal(transactionDepth, 0, 'provider must run outside SQL transactions and row locks');
      return provider(context);
    },
  });
  const runtime = { kind: db.kind, query: (...args) => db.query(...args),
    transaction: (fn) => db.transaction(async (tx) => {
      transactionDepth++;
      try { return await fn(tx); } finally { transactionDepth--; }
    }),
  };
  try {
    const migrationState = await migrate(db);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,
      migrationState.applied.length + migrationState.fresh.length);
    await seed(db, { demoPassword: PASSWORD });
    uploadDir = await mkdtemp(path.join(tmpdir(), 'sevens-b09-classifier-'));
    server = createServer(runtime, { origin: ORIGIN, secureCookies: false, uploadDir, logRequests: false, classifier });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, endpoint, auth = {}, body) => {
      const headers = { origin: ORIGIN };
      if (auth.cookie) headers.cookie = auth.cookie;
      if (auth.csrf) headers['x-csrf-token'] = auth.csrf;
      if (method !== 'GET') headers['idempotency-key'] = randomUUID();
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(base + endpoint, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = response.status === 204 ? null : await response.json();
      return { response, json };
    };
    const register = async () => {
      const result = await request('POST', '/api/v1/auth/register', {}, {
        displayName: 'Synthetic classifier citizen', email: `b09-${randomUUID()}@example.test`, password: PASSWORD, consentAccepted: true,
      });
      assert.equal(result.response.status, 201);
      return { cookie: result.response.headers.get('set-cookie').split(';')[0], csrf: result.json.data.csrfToken,
        id: result.json.data.user.id };
    };
    const territoryId = (await db.query("SELECT id FROM territories WHERE code='DEMO_SEMEY'")).rows[0].id;
    const draft = async (auth, input = TRANSPORT) => {
      const created = await request('POST', '/api/v1/ideas', auth,
        { ...input, territoryId, requestedCategoryCode: null });
      assert.equal(created.response.status, 201);
      return created.json.data;
    };
    const close = async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await db.close();
      const resolved = path.resolve(uploadDir);
      assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
      assert.ok(path.basename(resolved).startsWith('sevens-b09-classifier-'));
      await rm(resolved, { recursive: true, force: true });
    };
    return { db, request, register, draft, territoryId, close, calls: () => providerCalls };
  } catch (error) {
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await db.close();
    throw error;
  }
}

describe('B-09 classifier preview -> submit -> persisted citizen DTO', () => {
  let originalVersion;
  before(() => { originalVersion = process.env.ROUTING_CLASSIFIER_VERSION; process.env.ROUTING_CLASSIFIER_VERSION = 'rules-v2'; });
  after(() => {
    if (originalVersion === undefined) delete process.env.ROUTING_CLASSIFIER_VERSION;
    else process.env.ROUTING_CLASSIFIER_VERSION = originalVersion;
  });

  it('one cached provider call is shared by preview and submit, with persistent analysis and scoped reads', async () => {
    const test = await fixture(({ payload }) => answer(JSON.parse(payload.input)));
    try {
      const citizen = await test.register();
      const idea = await test.draft(citizen);
      assert.equal(test.calls(), 0, 'registration and draft creation must not classify');
      const preview = await test.request('POST', '/api/v1/ideas/routing-preview', citizen,
        { ...TRANSPORT, territoryId: test.territoryId, requestedCategoryCode: null });
      assert.equal(preview.response.status, 200);
      assert.equal(preview.json.data.classificationSource, 'MODEL');
      assert.equal(preview.json.data.classifierStatus, 'READY');
      assert.equal(preview.json.data.detectedCategoryCode, 'TRANSPORT');
      assert.equal(test.calls(), 1);
      const submitted = await test.request('POST', `/api/v1/ideas/${idea.id}/submit`, citizen,
        { expectedVersion: idea.version, consentAccepted: true });
      assert.equal(submitted.response.status, 200);
      assert.equal(submitted.json.data.status, 'RECEIVED');
      assert.equal(test.calls(), 1, 'submit must reuse the same semantic text cache');
      for (const field of ['detectedCategoryCode', 'effectiveCategoryCode', 'classificationSource', 'classifierStatus', 'ruleVersion', 'catalogVersion']) {
        assert.equal(submitted.json.data.routing[field], preview.json.data[field], field);
      }
      const analysis = (await test.db.query('SELECT analysis_json FROM routing_decisions WHERE idea_id=$1', [idea.id])).rows[0].analysis_json;
      assert.equal(analysis.detectedCategoryCode, 'TRANSPORT');
      assert.equal(analysis.classificationSource, 'MODEL');
      assert.equal(analysis.classifierStatus, 'READY');
      assert.equal(analysis.model, 'b09-fake-model');
      assert.ok(!JSON.stringify(analysis).includes('b09-test-only-not-a-real-key'));
      const detail = await test.request('GET', `/api/v1/ideas/${idea.id}`, citizen);
      assert.equal(detail.response.status, 200);
      assert.equal(detail.json.data.routing.detectedCategoryCode, 'TRANSPORT');
      assert.equal(detail.json.data.routing.classificationSource, 'MODEL');
      assert.equal(detail.json.data.routing.classifierStatus, 'READY');
      assert.equal(detail.json.data.routing.catalogVersion, preview.json.data.catalogVersion);
      assert.equal(detail.json.data.routing.analysis, undefined, 'raw internal analysis must not leak into the citizen DTO');
      const otherCitizen = await test.register();
      const foreign = await test.request('GET', `/api/v1/ideas/${idea.id}`, otherCitizen);
      assert.equal(foreign.response.status, 404);
      assert.equal(foreign.json.data, undefined);
      const login = await test.request('POST', '/api/v1/auth/login', {}, { email: 'utilities@example.test', password: PASSWORD });
      const staff = { cookie: login.response.headers.get('set-cookie').split(';')[0], csrf: login.json.data.csrfToken };
      const wrongOrg = await test.request('GET', `/api/v1/ideas/${idea.id}`, staff);
      assert.equal(wrongOrg.response.status, 404);
      const staffPreview = await test.request('POST', '/api/v1/ideas/routing-preview', staff,
        { ...TRANSPORT, territoryId: test.territoryId, requestedCategoryCode: null });
      assert.equal(staffPreview.response.status, 403);
      assert.equal(test.calls(), 1, 'denied roles cannot trigger a provider request');
    } finally { await test.close(); }
  });

  it('a grounded quotation alone cannot force a wrong confident model route against clear local evidence',async()=>{
    const test=await fixture(({payload})=>answer(JSON.parse(payload.input),'ECOLOGY'));
    try{
      const citizen=await test.register();
      const preview=await test.request('POST','/api/v1/ideas/routing-preview',citizen,
        {...TRANSPORT,territoryId:test.territoryId,requestedCategoryCode:null});
      assert.equal(preview.response.status,200);
      assert.equal(preview.json.data.classificationSource,'MODEL');
      assert.equal(preview.json.data.mode,'TRIAGE');
      assert.ok(preview.json.data.reasonCodes.includes('MODEL_RULES_DISAGREEMENT'));
      assert.notEqual(preview.json.data.confidenceBand,'HIGH');
    }finally{await test.close();}
  });

  it('a PATCH while provider work is pending invalidates prepared text and produces no stale submitted analysis', async () => {
    let release;
    let started;
    const gate = new Promise((resolve) => { started = resolve; });
    const test = await fixture(({ payload }) => {
      const text = JSON.parse(payload.input);
      if (text.title === TRANSPORT.title) {
        started();
        return new Promise((resolve) => { release = () => resolve(answer(text)); });
      }
      return answer(text, 'UTILITIES');
    });
    try {
      const citizen = await test.register();
      const idea = await test.draft(citizen);
      const pending = test.request('POST', `/api/v1/ideas/${idea.id}/submit`, citizen,
        { expectedVersion: idea.version, consentAccepted: true });
      let timer;
      try {
        await Promise.race([gate, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Provider barrier not reached')), 5000); })]);
        const patched = await test.request('PATCH', `/api/v1/ideas/${idea.id}`, citizen,
          { ...UTILITIES, expectedVersion: idea.version });
        assert.equal(patched.response.status, 200);
        assert.equal(patched.json.data.version, idea.version + 1);
      } finally { clearTimeout(timer); release?.(); }
      const stale = await pending;
      assert.equal(stale.response.status, 409);
      assert.equal(stale.json.error.code, 'VERSION_CONFLICT');
      const preserved = (await test.db.query('SELECT title,solution,status,version FROM ideas WHERE id=$1', [idea.id])).rows[0];
      assert.deepEqual(preserved, { title: UTILITIES.title, solution: UTILITIES.solution, status: 'DRAFT', version: idea.version + 1 });
      assert.equal((await test.db.query('SELECT count(*)::int AS n FROM routing_decisions WHERE idea_id=$1', [idea.id])).rows[0].n, 0);
      const retry = await test.request('POST', `/api/v1/ideas/${idea.id}/submit`, citizen,
        { expectedVersion: preserved.version, consentAccepted: true });
      assert.equal(retry.response.status, 200);
      assert.equal(retry.json.data.routing.detectedCategoryCode, 'UTILITIES');
      assert.equal(test.calls(), 2);
      const analysis = (await test.db.query('SELECT analysis_json FROM routing_decisions WHERE idea_id=$1', [idea.id])).rows[0].analysis_json;
      assert.equal(analysis.detectedCategoryCode, 'UTILITIES');
      assert.equal(analysis.classificationSource, 'MODEL');
    } finally { release?.(); await test.close(); }
  });

  it('provider outage falls back locally and never prevents citizen or idea registration', async () => {
    const test = await fixture(() => { throw new Error('injected provider outage'); });
    try {
      const citizen = await test.register();
      assert.equal(test.calls(), 0);
      const idea = await test.draft(citizen);
      const preview = await test.request('POST', '/api/v1/ideas/routing-preview', citizen,
        { ...TRANSPORT, territoryId: test.territoryId, requestedCategoryCode: null });
      assert.equal(preview.response.status, 200);
      assert.equal(preview.json.data.classificationSource, 'RULES');
      assert.equal(preview.json.data.classifierStatus, 'FALLBACK');
      const submit = await test.request('POST', `/api/v1/ideas/${idea.id}/submit`, citizen,
        { expectedVersion: idea.version, consentAccepted: true });
      assert.equal(submit.response.status, 200);
      assert.equal(submit.json.data.status, 'RECEIVED');
      assert.equal(submit.json.data.routing.classificationSource, 'RULES');
      assert.equal(submit.json.data.routing.classifierStatus, 'FALLBACK');
      assert.equal(test.calls(), 1, 'failure cache avoids a repeated provider call during submission');
      const row = (await test.db.query('SELECT public_number,status FROM ideas WHERE id=$1', [idea.id])).rows[0];
      assert.ok(row.public_number);
      assert.equal(row.status, 'RECEIVED');
      const analysis = (await test.db.query('SELECT analysis_json FROM routing_decisions WHERE idea_id=$1', [idea.id])).rows[0].analysis_json;
      assert.equal(analysis.classifierStatus, 'FALLBACK');
      assert.equal(analysis.fallbackReason, 'CLASSIFIER_UNAVAILABLE');
    } finally { await test.close(); }
  });

  it('an injected ready local model replaces an unavailable API and its result is cached for submit', async () => {
    let localCalls = 0;
    const test = await fixture(() => { throw new Error('injected API outage'); }, {
      localEnabled: true,
      localProvider: async (text) => {
        localCalls++;
        return { ...answer(text), localMetadata: { model: 'b09-fake-local-model', topScore: 0.81, gap: 0.25, truncated: false } };
      },
    });
    try {
      const citizen = await test.register();
      const idea = await test.draft(citizen);
      const preview = await test.request('POST', '/api/v1/ideas/routing-preview', citizen,
        { ...TRANSPORT, territoryId: test.territoryId, requestedCategoryCode: null });
      assert.equal(preview.response.status, 200);
      assert.equal(preview.json.data.classificationSource, 'MODEL');
      assert.equal(preview.json.data.classifierStatus, 'READY');
      const submit = await test.request('POST', `/api/v1/ideas/${idea.id}/submit`, citizen,
        { expectedVersion: idea.version, consentAccepted: true });
      assert.equal(submit.response.status, 200);
      assert.equal(submit.json.data.routing.detectedCategoryCode, 'TRANSPORT');
      assert.equal(test.calls(), 1);
      assert.equal(localCalls, 1);
      const analysis = (await test.db.query('SELECT analysis_json FROM routing_decisions WHERE idea_id=$1', [idea.id])).rows[0].analysis_json;
      assert.equal(analysis.model, 'b09-fake-local-model');
      assert.equal(analysis.classifierStatus, 'READY');
    } finally { await test.close(); }
  });
});
