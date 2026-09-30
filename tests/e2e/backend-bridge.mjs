// Production HTTP smoke: Next same-origin proxy -> API -> PostgreSQL. All
// mutations create synthetic demo data; credentials/tokens are never reported.
// Required: SMOKE_BASE, SMOKE_PASSWORD. Restart verification additionally uses
// SMOKE_MODE=verify, SMOKE_EMAIL, SMOKE_ID, optional SMOKE_ATTACHMENT_ID.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VALID_PNG } from '../integration/backend/helpers/valid-png.mjs';

const PUBLIC_REPLY = 'Идея принята к рассмотрению специалистом по транспорту; комментарий сохранён на платформе.';
const INTERNAL_PREFIX = 'Внутренняя служебная заметка HTTP smoke';
const CLARIFICATION_QUESTION = 'Уточните предполагаемое место установки светофоров возле школы.';
const CLARIFICATION_REPLY = 'Установить светофоры возле центрального входа в школу и пешеходного перехода.';
const FINAL_REPLY = 'Предложение рассмотрено; итоговый ответ направлен автору на платформе.';
const REJECTED_REPLY = 'Предложенный участок не подходит для пилота по итогам рассмотрения; причина сохранена для автора.';

export async function runSmoke({ base, password, mode = 'full', email: persistedEmail,
  ideaId: persistedId, attachmentId: persistedAttachmentId, checkAssets = true } = {}) {
  if (!base || !password) throw new Error('SMOKE_BASE and SMOKE_PASSWORD are required');
  if (!['full', 'verify'].includes(mode)) throw new Error('Unknown SMOKE_MODE');
  const origin = new URL(base).origin;
  const checks = [];
  const check = (name) => checks.push(name);

  async function request(method, pathname, { auth, body, key, form } = {}) {
    const headers = { origin };
    if (auth?.cookie) headers.cookie = auth.cookie;
    if (auth?.csrf) headers['x-csrf-token'] = auth.csrf;
    if (key) headers['idempotency-key'] = key;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(new URL(pathname, base), { method, headers,
      body: form || (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(15_000) });
    let value = null;
    if (response.status !== 204) {
      try { value = await response.json(); }
      catch { throw new Error(`${method} ${pathname}: expected JSON, HTTP ${response.status}`); }
    }
    return { status: response.status, value, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }

  function expect(result, status, context) {
    // Do not serialize an unexpected login/me response, which may contain CSRF.
    assert.equal(result.status, status, `${context}: HTTP ${result.status}, ${result.value?.error?.code || 'unexpected response'}`);
    if (result.value) assert.ok(result.value.meta?.requestId, `${context}: requestId missing`);
    return result.value?.data;
  }

  async function signIn(email) {
    const result = await request('POST', '/api/v1/auth/login', { body: { email, password } });
    const data = expect(result, 200, 'login');
    assert.ok(result.cookie && data.csrfToken);
    return { cookie: result.cookie, csrf: data.csrfToken, user: data.user };
  }

  const detail = async (id, auth) => expect(await request('GET', `/api/v1/ideas/${id}`, { auth }), 200, 'idea detail');
  const timeline = async (id, auth) => expect(await request('GET', `/api/v1/ideas/${id}/timeline`, { auth }), 200, 'idea timeline');
  const notifications = async (auth, query = '') => {
    const response = await request('GET', '/api/v1/notifications?pageSize=100' + query, { auth });
    expect(response, 200, 'notifications');
    assert.ok(Number.isSafeInteger(response.value.meta.unreadCount));
    return response.value;
  };
  const mutate = async (pathname, auth, body, status = 200) => expect(await request('POST', pathname,
    { auth, body, key: randomUUID() }), status, pathname);
  const changeStatus = (id, auth, body) => mutate(`/api/v1/ideas/${id}/status`, auth, body);

  async function download(id, auth, expectedStatus = 200) {
    const response = await fetch(new URL(`/api/v1/attachments/${id}/download`, base), {
      headers: { cookie: auth.cookie }, signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, expectedStatus, 'attachment download');
    if (expectedStatus === 200) {
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), VALID_PNG);
    } else {
      const denied = await response.json();
      assert.equal(denied.error.code, 'NOT_FOUND');
    }
  }

  async function upload(id, version, auth) {
    const form = new FormData();
    form.append('expectedVersion', String(version));
    form.append('file', new Blob([VALID_PNG], { type: 'image/png' }), 'sample.png');
    return expect(await request('POST', `/api/v1/ideas/${id}/attachments`, { auth, key: randomUUID(), form }), 201, 'upload');
  }

  expect(await request('GET', '/api/health/ready'), 200, 'readiness');
  if (checkAssets) {
    for (const asset of ['/sevens/city-illustration.png', '/sevens-city-fallback.svg']) {
      const response = await fetch(new URL(asset, base), { signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 200, `public asset ${asset}`);
      assert.match(response.headers.get('content-type') || '', /^image\//);
      assert.ok((await response.arrayBuffer()).byteLength > 32, `empty asset ${asset}`);
    }
    check('production-assets');
  }

  if (mode === 'verify') {
    if (!persistedEmail || !persistedId) throw new Error('SMOKE_EMAIL and SMOKE_ID are required for verification');
    const auth = await signIn(persistedEmail);
    const saved = await detail(persistedId, auth);
    assert.equal(saved.status, 'COMPLETED');
    assert.equal(saved.resolutionType, 'ANSWER_PROVIDED');
    const events = await timeline(persistedId, auth);
    assert.ok(events.some((event) => event.type === 'SUBMITTED'));
    assert.ok(events.some((event) => event.body === PUBLIC_REPLY));
    assert.ok(events.some((event) => event.body === CLARIFICATION_QUESTION));
    assert.ok(events.some((event) => event.body === CLARIFICATION_REPLY));
    assert.ok(events.some((event) => event.toStatus === 'COMPLETED' && event.body === FINAL_REPLY));
    assert.ok(!JSON.stringify(events).includes(INTERNAL_PREFIX));
    const fileId = persistedAttachmentId || saved.attachments[0]?.id;
    assert.ok(fileId && saved.attachments.some((file) => file.id === fileId));
    await download(fileId, auth);
    const notice = await notifications(auth);
    assert.ok(notice.data.some((item) => item.ideaId === persistedId));
    check('persisted-idea-timeline-notifications-file');
    return { passed: true, verifiedAfterRestart: true, email: persistedEmail,
      ideaId: persistedId, publicNumber: saved.publicNumber, attachmentId: fileId, checks };
  }

  const catalogs = expect(await request('GET', '/api/v1/catalogs'), 200, 'catalogs');
  const territoryId = (catalogs.territories.find((territory) => territory.code === 'DEMO_SEMEY') || catalogs.territories[0])?.id;
  assert.ok(territoryId && catalogs.categories.some((category) => category.code === 'TRANSPORT'));
  const nonce = randomUUID();
  const email = `smoke-${nonce}@example.test`;
  const registered = await request('POST', '/api/v1/auth/register', {
    body: { displayName: 'Проверочный житель', email, password, consentAccepted: true } });
  const citizenData = expect(registered, 201, 'register');
  const citizen = { cookie: registered.cookie, csrf: citizenData.csrfToken, user: citizenData.user };
  const input = {
    title: `Умные светофоры возле школы ${nonce}`,
    problem: 'Возле школы дорога перегружена, детям нужен более безопасный переход и точные данные о потоке.',
    solution: 'Установить умные светофоры и датчики загруженности дороги с цифровым мониторингом.',
    territoryId, requestedCategoryCode: null,
  };
  const mineBefore = await request('GET', '/api/v1/ideas?scope=mine', { auth: citizen });
  expect(mineBefore, 200, 'empty mine');
  const preview = await request('POST', '/api/v1/ideas/routing-preview', { auth: citizen, body: input });
  const predicted = expect(preview, 200, 'routing preview');
  assert.equal(preview.value.meta.preview, true);
  assert.equal(predicted.effectiveCategoryCode, 'TRANSPORT');
  assert.equal(predicted.organizationCode, 'DEMO_TRANSPORT');
  assert.ok(predicted.tags.includes('SMART_CITY'));
  const mineAfter = await request('GET', '/api/v1/ideas?scope=mine', { auth: citizen });
  expect(mineAfter, 200, 'mine after preview');
  assert.equal(mineAfter.value.meta.total, mineBefore.value.meta.total);
  check('preview-without-persistence');

  const draft = await mutate('/api/v1/ideas', citizen, input, 201);
  const uploaded = await upload(draft.id, draft.version, citizen);
  await download(uploaded.attachment.id, citizen);
  expect(await request('POST', '/api/v1/ideas', {
    auth: { cookie: citizen.cookie }, key: randomUUID(), body: input }), 403, 'CSRF denied');
  const submitBody = { expectedVersion: uploaded.ideaVersion, consentAccepted: true };
  const submitKey = randomUUID();
  const submitted = expect(await request('POST', `/api/v1/ideas/${draft.id}/submit`, {
    auth: citizen, key: submitKey, body: submitBody }), 200, 'submit');
  assert.equal(submitted.routing.effectiveCategoryCode, predicted.effectiveCategoryCode);
  assert.equal(submitted.routing.organizationCode, predicted.organizationCode);
  const noticesBeforeReplay = await notifications(citizen);
  assert.deepEqual(expect(await request('POST', `/api/v1/ideas/${draft.id}/submit`, {
    auth: citizen, key: submitKey, body: submitBody }), 200, 'submit replay'), submitted);
  assert.equal((await notifications(citizen)).meta.total, noticesBeforeReplay.meta.total);
  check('upload-submit-routing-idempotency');

  const staff = await signIn('transport@example.test');
  const otherStaff = await signIn('utilities@example.test');
  const triageStaff = await signIn('triage@example.test');
  const admin = await signIn('admin@example.test');
  expect(await request('GET', `/api/v1/ideas/${draft.id}`, { auth: otherStaff }), 404, 'foreign staff detail denied');
  await download(uploaded.attachment.id, otherStaff, 404);
  expect(await request('POST', `/api/v1/ideas/${draft.id}/status`, {
    auth: otherStaff, key: randomUUID(), body: { toStatus: 'UNDER_REVIEW', takeOwnership: true, expectedVersion: submitted.version } }), 404, 'foreign staff mutation denied');
  const queue = expect(await request('GET', `/api/v1/ideas?scope=staff&q=${encodeURIComponent(submitted.publicNumber)}`, { auth: staff }), 200, 'staff queue');
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, draft.id);
  const assignees = expect(await request('GET', `/api/v1/staff/assignees?organizationId=${staff.user.organizationId}`, { auth: staff }), 200, 'assignees');
  assert.ok(assignees.some((candidate) => candidate.id === staff.user.id));
  const assigned = await mutate(`/api/v1/ideas/${draft.id}/assignment`, staff, {
    assigneeId: staff.user.id, expectedVersion: submitted.version });
  const reviewing = await changeStatus(draft.id, staff, { toStatus: 'UNDER_REVIEW', expectedVersion: assigned.version });
  const beforePublic = await notifications(citizen);
  const publicReply = await mutate(`/api/v1/ideas/${draft.id}/comments`, staff, {
    visibility: 'PUBLIC', body: PUBLIC_REPLY, expectedVersion: reviewing.version }, 201);
  const afterPublic = await notifications(citizen);
  assert.equal(afterPublic.meta.total, beforePublic.meta.total + 1);
  const privateText = `${INTERNAL_PREFIX} ${nonce}`;
  const internalReply = await mutate(`/api/v1/ideas/${draft.id}/comments`, staff, {
    visibility: 'INTERNAL', body: privateText, expectedVersion: publicReply.ideaVersion }, 201);
  assert.equal((await notifications(citizen)).meta.total, afterPublic.meta.total);
  assert.ok((await timeline(draft.id, staff)).some((event) => event.body === privateText));
  assert.ok(!JSON.stringify(await timeline(draft.id, citizen)).includes(INTERNAL_PREFIX));
  assert.ok(!JSON.stringify(await detail(draft.id, citizen)).includes(INTERNAL_PREFIX));
  const requested = await changeStatus(draft.id, staff, { toStatus: 'NEEDS_INFO',
    expectedVersion: internalReply.ideaVersion, publicComment: CLARIFICATION_QUESTION });
  const clarified = await mutate(`/api/v1/ideas/${draft.id}/clarifications`, citizen, {
    expectedVersion: requested.version, body: CLARIFICATION_REPLY });
  assert.equal(clarified.status, 'UNDER_REVIEW');
  const working = await changeStatus(draft.id, staff, { toStatus: 'IN_PROGRESS', expectedVersion: clarified.version });
  const completed = await changeStatus(draft.id, staff, { toStatus: 'COMPLETED', expectedVersion: working.version,
    resolutionType: 'ANSWER_PROVIDED', publicComment: FINAL_REPLY });
  assert.equal(completed.status, 'COMPLETED');
  const primaryEvents = await timeline(draft.id, citizen);
  for (const text of [PUBLIC_REPLY, CLARIFICATION_QUESTION, CLARIFICATION_REPLY, FINAL_REPLY]) assert.ok(primaryEvents.some((event) => event.body === text));
  assert.ok((await timeline(draft.id, staff)).some((event) => event.type === 'ASSIGNED'));
  assert.ok(!JSON.stringify(primaryEvents).includes(INTERNAL_PREFIX));
  check('assignment-public-internal-clarification-completion');

  const notices = await notifications(citizen);
  // Registration + four staff status moves + one public reply; an internal
  // note and the author's own clarification do not notify that author.
  assert.equal(notices.meta.total, 6);
  assert.equal(notices.meta.unreadCount, notices.meta.total);
  const unreadPage = await request('GET', '/api/v1/notifications?pageSize=1&unreadOnly=true', { auth: citizen });
  expect(unreadPage, 200, 'unread one-item page');
  assert.equal(unreadPage.value.data.length, 1);
  assert.equal(unreadPage.value.meta.unreadCount, notices.meta.unreadCount);
  const noticeId = unreadPage.value.data[0].id;
  for (let repeat = 0; repeat < 2; repeat++) expect(await request('POST', `/api/v1/notifications/${noticeId}/read`, { auth: citizen, body: {} }), 204, 'notification read');
  const marked = await notifications(citizen);
  assert.equal(marked.meta.total, notices.meta.total);
  assert.equal(marked.meta.unreadCount, notices.meta.unreadCount - 1);
  check('notification-total-global-unread-count');

  const analyticsPath = `/api/v1/analytics/summary?q=${encodeURIComponent(submitted.publicNumber)}`;
  const summary = expect(await request('GET', analyticsPath, { auth: staff }), 200, 'staff analytics');
  assert.equal(summary.total, 1);
  assert.equal(summary.byStatus.COMPLETED, 1);
  assert.equal(summary.byCategory.TRANSPORT, 1);
  assert.equal(summary.unassigned, 0);
  assert.ok(Number.isFinite(summary.medianFirstReviewSeconds) && summary.medianFirstReviewSeconds >= 0);
  assert.equal(expect(await request('GET', analyticsPath, { auth: otherStaff }), 200, 'foreign analytics').total, 0);
  expect(await request('GET', analyticsPath, { auth: citizen }), 403, 'citizen analytics denied');
  check('scoped-filtered-analytics');

  const conflictDraft = await mutate('/api/v1/ideas', citizen, { ...input,
    title: `Светофоры и датчики для транспорта ${nonce}`, requestedCategoryCode: 'ECOLOGY' }, 201);
  const conflictUpload = await upload(conflictDraft.id, conflictDraft.version, citizen);
  const conflict = await mutate(`/api/v1/ideas/${conflictDraft.id}/submit`, citizen,
    { expectedVersion: conflictUpload.ideaVersion, consentAccepted: true });
  assert.equal(conflict.routing.effectiveCategoryCode, 'ECOLOGY');
  assert.equal(conflict.routing.mode, 'TRIAGE');
  assert.equal(conflict.routing.organizationCode, 'DEMO_TRIAGE');
  await detail(conflictDraft.id, triageStaff);
  await download(conflictUpload.attachment.id, triageStaff);
  const orgs = expect(await request('GET', '/api/v1/admin/organizations', { auth: admin }), 200, 'organizations');
  const transportOrgId = orgs.find((organization) => organization.code === 'DEMO_TRANSPORT')?.id;
  assert.ok(transportOrgId);
  const rerouted = await mutate(`/api/v1/admin/ideas/${conflictDraft.id}/reroute`, admin, {
    organizationId: transportOrgId, effectiveCategoryCode: 'TRANSPORT',
    reason: 'Транспортная тема подтверждена ручной проверкой.', expectedVersion: conflict.version });
  assert.equal((await detail(conflictDraft.id, citizen)).publicNumber, conflict.publicNumber);
  expect(await request('GET', `/api/v1/ideas/${conflictDraft.id}`, { auth: triageStaff }), 404, 'old organization detail denied');
  expect(await request('GET', `/api/v1/ideas/${conflictDraft.id}/timeline`, { auth: triageStaff }), 404, 'old organization timeline denied');
  await download(conflictUpload.attachment.id, triageStaff, 404);
  await download(conflictUpload.attachment.id, staff);
  const claimed = await changeStatus(conflictDraft.id, staff, { toStatus: 'UNDER_REVIEW', takeOwnership: true, expectedVersion: rerouted.version });
  expect(await request('POST', `/api/v1/ideas/${conflictDraft.id}/status`, { auth: staff, key: randomUUID(),
    body: { toStatus: 'REJECTED', expectedVersion: claimed.version } }), 400, 'rejection requires reason');
  const afterInvalidReject = await detail(conflictDraft.id, staff);
  assert.equal(afterInvalidReject.status, 'UNDER_REVIEW');
  assert.equal(afterInvalidReject.version, claimed.version);
  const conflictRequested = await changeStatus(conflictDraft.id, staff, { toStatus: 'NEEDS_INFO',
    expectedVersion: claimed.version, publicComment: CLARIFICATION_QUESTION });
  const conflictClarified = await mutate(`/api/v1/ideas/${conflictDraft.id}/clarifications`, citizen, {
    expectedVersion: conflictRequested.version, body: CLARIFICATION_REPLY });
  const rejected = await changeStatus(conflictDraft.id, staff, { toStatus: 'REJECTED',
    expectedVersion: conflictClarified.version, publicComment: REJECTED_REPLY });
  assert.equal(rejected.status, 'REJECTED');
  const conflictEvents = await timeline(conflictDraft.id, citizen);
  assert.ok(conflictEvents.some((event) => event.type === 'REROUTED'));
  assert.ok(conflictEvents.some((event) => event.toStatus === 'REJECTED' && event.body === REJECTED_REPLY));
  assert.equal(expect(await request('GET', `/api/v1/analytics/summary?q=${encodeURIComponent(conflict.publicNumber)}`, { auth: triageStaff }), 200, 'old organization analytics').total, 0);
  check('conflict-reroute-old-organization-file-revoked-rejection-reason');

  const outsiderResult = await request('POST', '/api/v1/auth/register', {
    body: { displayName: 'Другой житель', email: `outsider-${nonce}@example.test`, password, consentAccepted: true } });
  const outsiderData = expect(outsiderResult, 201, 'outsider register');
  const outsider = { cookie: outsiderResult.cookie, csrf: outsiderData.csrfToken };
  expect(await request('GET', `/api/v1/ideas/${draft.id}`, { auth: outsider }), 404, 'foreign citizen idea denied');
  expect(await request('GET', `/api/v1/ideas/${draft.id}/timeline`, { auth: outsider }), 404, 'foreign citizen timeline denied');
  await download(uploaded.attachment.id, outsider, 404);
  expect(await request('POST', `/api/v1/notifications/${noticeId}/read`, { auth: outsider, body: {} }), 404, 'foreign notification denied');
  check('citizen-and-organization-object-denial');
  return { passed: true, email, ideaId: draft.id, publicNumber: submitted.publicNumber,
    attachmentId: uploaded.attachment.id, rejectedIdeaId: conflictDraft.id,
    rejectedAttachmentId: conflictUpload.attachment.id, category: predicted.effectiveCategoryCode,
    triageAndClarification: true, checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runSmoke({ base: process.env.SMOKE_BASE || 'http://localhost:3000',
      password: process.env.SMOKE_PASSWORD, mode: process.env.SMOKE_MODE || 'full',
      email: process.env.SMOKE_EMAIL, ideaId: process.env.SMOKE_ID, attachmentId: process.env.SMOKE_ATTACHMENT_ID });
    console.log(JSON.stringify(report));
  } catch (error) {
    console.log(JSON.stringify({ passed: false, error: error.message }));
    process.exitCode = 1;
  }
}
