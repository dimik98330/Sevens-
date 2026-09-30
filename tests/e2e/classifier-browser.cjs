// One real browser idea on the explicitly authorized isolated production stand.
// No network interception, mock data, provider retries or client model loading.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const origin = process.env.CLASSIFIER_BROWSER_BASE || 'http://127.0.0.1:3229';
if (new URL(origin).origin !== 'http://127.0.0.1:3229') throw new Error('Expected the isolated classifier production stand on port 3229');
const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const out = path.resolve(root, '.data/classifier-verification/browser', runId);
fs.mkdirSync(out, { recursive: true });
const email = `classifier-browser-${runId}@example.test`;
const password = `Synthetic-${randomBytes(16).toString('hex')}`;
const idea = {
  title: `Умные светофоры рядом со школой — проверка ${runId}`,
  problem: 'Возле школы дорога перегружена в часы пик. Детям трудно безопасно перейти улицу, светофор не учитывает поток автомобилей.',
  solution: 'Установить умные светофоры и датчики загруженности дороги, чтобы безопасно пропускать детей у школы.',
  locationText: 'У перехода возле школы. Синтетический пример для проверки сервиса.',
};
const report = { origin, runId, startedAt: new Date().toISOString(), status: 'RUNNING',
  checks: [], screenshots: [], pageErrors: [], requests: { preview: 0, submit: 0, assistant: 0 },
  email, providerCalls: { expected: 1, observed: null, evidence: 'Server budget SQL confirmation required; browser counts are separate.' } };
const check = (name, detail = true) => report.checks.push({ name, pass: true, detail });
const writeReport = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');

async function screenshot(page, name, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.waitForFunction(() => !document.querySelector('.skeleton'));
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false, `${name}: horizontal overflow at ${width}px`);
  const filename = `${name}-${width}.png`;
  await page.screenshot({ path: path.join(out, filename), fullPage: true });
  report.screenshots.push(path.join(out, filename));
}

async function responseJson(response, expected, label) {
  assert.equal(response.status(), expected, `${label}: HTTP ${response.status()}`);
  const result = await response.json();
  assert.ok(result.meta?.requestId && !result.meta.requestId.includes('mock'), `${label}: real server requestId required`);
  return result;
}

(async () => {
  let browser;
  let context;
  let page;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', locale: 'ru-RU' });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      const endpoint = new URL(request.url()).pathname;
      if (endpoint === '/api/v1/ideas/routing-preview') report.requests.preview++;
      if (/\/api\/v1\/ideas\/[^/]+\/submit$/.test(endpoint)) report.requests.submit++;
      if (endpoint === '/api/v1/assistant/chat') report.requests.assistant++;
    });
    const health = await context.request.get(origin + '/api/health/ready');
    assert.equal(health.status(), 200, 'isolated production readiness');
    check('Isolated production stand is ready');

    await page.goto(origin + '/register');
    await page.locator('#name').fill('Синтетический житель проверки классификатора');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    const registrationResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/auth/register'
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
    const registration = await responseJson(await registrationResponse, 201, 'UI registration');
    report.actorId = registration.data.user.id;
    await page.waitForURL(/\/my(?:\?|$)/);
    check('Citizen registered through current real UI');

    const catalogsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/catalogs');
    await page.goto(origin + '/ideas/new?mock=0');
    const catalogs = await responseJson(await catalogsResponse, 200, 'live catalog');
    const territory = catalogs.data.territories.find((item) => item.code === 'DEMO_SEMEY');
    assert.match(territory?.id || '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    report.territoryId = territory.id;
    await page.locator('#title').fill(idea.title);
    await page.locator('#problem').fill(idea.problem);
    await page.locator('#solution').fill(idea.solution);
    await screenshot(page, 'step1-preserved', 1440);
    await screenshot(page, 'step1-preserved', 390);
    assert.equal(report.requests.preview, 0, 'step1 must not call the classifier');
    await page.getByRole('button', { name: 'Далее', exact: true }).click();
    await page.locator('#territory').waitFor();
    await page.waitForURL(/draft=/);
    report.ideaId = new URL(page.url()).searchParams.get('draft');
    assert.ok(report.ideaId);
    await page.locator('#territory').selectOption(territory.id);
    await page.locator('#location').fill(idea.locationText);
    assert.equal(await page.locator('#category').inputValue(), 'AUTO');
    await screenshot(page, 'step2-preserved', 390);

    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    assert.equal(await page.locator('#title').inputValue(), idea.title);
    assert.equal(await page.locator('#problem').inputValue(), idea.problem);
    assert.equal(await page.locator('#solution').inputValue(), idea.solution);
    await page.getByRole('button', { name: 'Далее', exact: true }).click();
    await page.locator('#territory').waitFor();
    assert.equal(await page.locator('#territory').inputValue(), territory.id);
    assert.equal(await page.locator('#location').inputValue(), idea.locationText);
    assert.equal(report.requests.preview, 0, 'step2 must not call the classifier');
    check('Form text and location survive backward/forward navigation; no classification before step3');

    const previewResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/ideas/routing-preview'
      && response.request().method() === 'POST', { timeout: 30000 });
    await page.getByRole('button', { name: 'Далее', exact: true }).click();
    await page.getByRole('heading', { name: 'Проверка перед отправкой', exact: true }).waitFor();
    const previewRaw = await previewResponse;
    const previewBody = previewRaw.request().postDataJSON();
    assert.equal(previewBody.title, idea.title);
    assert.equal(previewBody.problem, idea.problem);
    assert.equal(previewBody.solution, idea.solution);
    assert.equal(previewBody.territoryId, territory.id);
    assert.equal(previewBody.requestedCategoryCode, null);
    const preview = (await responseJson(previewRaw, 200, 'real classifier preview')).data;
    assert.equal(preview.classificationSource, 'MODEL', 'real model result required for this run');
    assert.equal(preview.classifierStatus, 'READY');
    assert.equal(preview.classificationMethod, 'LLM', 'external API result required, not local model/rules fallback');
    assert.equal(preview.detectedCategoryCode, 'TRANSPORT');
    assert.ok(preview.tags.includes('SMART_CITY'));
    assert.equal(preview.organizationCode, preview.mode === 'TRIAGE' ? 'DEMO_TRIAGE' : 'DEMO_TRANSPORT');
    report.preview = preview;
    await page.locator('.route-card').waitFor();
    const card = await page.locator('.route-card').innerText();
    assert.ok(card.includes(preview.explanation.replace(/Демо:\s*/g, '')));
    assert.ok(card.includes('Категория заявки:') && card.includes('Тема по тексту:'));
    assert.ok(!card.includes('DEMO_'));
    assert.ok(!/\d+%/.test(card));
    await screenshot(page, 'step3-api-preview', 1440);
    await screenshot(page, 'step3-api-preview', 390);
    assert.equal(report.requests.preview, 1, 'resizing a review must not request a second classification');
    check('Review renders the real API model topic, tags, explanation and organization', {
      classificationMethod: preview.classificationMethod, category: preview.detectedCategoryCode,
      mode: preview.mode, organizationCode: preview.organizationCode });

    await page.locator('#consent').check();
    const submitResponse = page.waitForResponse((response) => /\/api\/v1\/ideas\/[^/]+\/submit$/.test(new URL(response.url()).pathname)
      && response.request().method() === 'POST', { timeout: 30000 });
    await page.getByRole('button', { name: 'Отправить идею', exact: true }).click();
    const submitted = (await responseJson(await submitResponse, 200, 'idea submit')).data;
    assert.equal(submitted.id, report.ideaId);
    assert.equal(submitted.status, 'RECEIVED');
    for (const field of ['detectedCategoryCode', 'effectiveCategoryCode', 'organizationCode', 'mode', 'classificationSource', 'classifierStatus', 'classificationMethod', 'ruleVersion', 'catalogVersion']) {
      assert.equal(submitted.routing[field], preview[field], `preview/submit ${field}`);
    }
    report.submitted = submitted;
    report.publicNumber = submitted.publicNumber;
    await page.getByText(/Идея зарегистрирована на платформе/).waitFor();
    await screenshot(page, 'submitted-real', 390);
    assert.equal(report.requests.preview, 1);
    assert.equal(report.requests.submit, 1);
    check('One submit confirms the same server routing as the preview, without another preview POST');

    await page.getByRole('link', { name: 'Открыть идею', exact: true }).click();
    await page.waitForURL(origin + `/ideas/${report.ideaId}`);
    await page.getByRole('heading', { name: idea.title, exact: true }).waitFor();
    const detailResponse = await context.request.get(origin + `/api/v1/ideas/${report.ideaId}`);
    const detail = (await responseJson(detailResponse, 200, 'persisted idea read')).data;
    assert.equal(detail.title, idea.title);
    assert.equal(detail.problem, idea.problem);
    assert.equal(detail.solution, idea.solution);
    assert.equal(detail.locationText, idea.locationText);
    assert.equal(detail.status, 'RECEIVED');
    assert.equal(detail.routing.classificationMethod, 'LLM');
    assert.equal(detail.routing.detectedCategoryCode, preview.detectedCategoryCode);
    await screenshot(page, 'persisted-model-route', 1440);
    await screenshot(page, 'persisted-model-route', 390);
    check('Fresh server detail preserves form fields and the actual external-model result');
    assert.deepEqual(report.pageErrors, []);
    assert.equal(report.requests.assistant, 0, 'this run must not add unrelated paid assistant work');
    report.status = 'PASS';
    report.finishedAt = new Date().toISOString();
    writeReport();
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, requests: report.requests,
      actorId: report.actorId, ideaId: report.ideaId, publicNumber: report.publicNumber, report: path.join(out, 'report.json') }));
  } catch (error) {
    report.status = 'FAIL';
    report.failure = error.message;
    if (page) await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    writeReport();
    console.error(JSON.stringify({ status: 'FAIL', failure: error.message, report: path.join(out, 'report.json'), requests: report.requests }));
    process.exitCode = 1;
  } finally {
    if (context) {
      // End only the synthetic session created by this run; no account deletion.
      await context.request.get(origin + '/api/v1/auth/me').then(async (response) => {
        if (!response.ok()) return;
        const csrf = (await response.json()).data.csrfToken;
        await context.request.post(origin + '/api/v1/auth/logout', { headers: { origin, 'x-csrf-token': csrf }, data: {} });
      }).catch(() => {});
      await context.close();
    }
    await browser?.close();
  }
})();
