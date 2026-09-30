// Non-destructive browser verification against the isolated Sevens PG17 stand.
// Playwright is provided by the workspace runtime (NODE_PATH), no external keys logged.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { parseEnv } = require("node:util");
const { randomUUID } = require("node:crypto");
const root = path.resolve(__dirname, "../..");
if (process.env.SMOKE_BASE && !process.env.SMOKE_PASSWORD) throw new Error('SMOKE_PASSWORD is required for an isolated browser run');
const config = process.env.SMOKE_PASSWORD ? { DEMO_PASSWORD: process.env.SMOKE_PASSWORD } : parseEnv(
  fs.readFileSync(path.join(root, ".env.sevens"), "utf8"),
);
const origin = process.env.SMOKE_BASE || "http://127.0.0.1:3100";
const out = process.env.SEVENS_BROWSER_OUT || path.join(root, "docs/design/screenshots/final");
fs.mkdirSync(out, { recursive: true });
const report = {
  origin,
  date: new Date().toISOString(),
  checks: [],
  screenshots: [],
  errors: [],
  live2gis: "NOT RUN: no user Map Tiles API key",
  geometryInput:
    "Saved through authenticated HTTP contract; map drawing is not claimed",
};
const validPngPromise = require('sharp')({ create: {
  width:2,height:2,channels:3,background:'#257a6c',
} }).png().toBuffer();
const zone = {
  type: "Polygon",
  coordinates: [
    [
      [80.246, 50.41],
      [80.25, 50.41],
      [80.25, 50.413],
      [80.246, 50.413],
      [80.246, 50.41],
    ],
  ],
};
const email =
  process.env.SEVENS_RESUME_EMAIL ||
  `sevens-browser-${Date.now()}@example.test`;
const title = "Безопасный переход у школы — Sevens";
const publicText =
  "Предложение изучено транспортным специалистом. Рассмотрим возможность улучшения перехода и освещения. Ответ сохранён в истории идеи.";
const internalText = "Внутренняя проверочная заметка Sevens " + randomUUID();
const check = (name, detail = true) => {
  report.checks.push({ name, pass: true, detail });
};
async function api(context, method, url, body, expected = 200) {
  const headers = { origin };
  if (method !== "GET") {
    const me = await context.request.get(origin + "/api/v1/auth/me");
    assert.equal(me.status(), 200);
    headers["x-csrf-token"] = (await me.json()).data.csrfToken;
    headers["idempotency-key"] = randomUUID();
  }
  const response = await context.request.fetch(origin + url, {
    method,
    headers,
    ...(body === undefined ? {} : { data: body }),
  });
  assert.equal(
    response.status(),
    expected,
    method + " " + url + " returned " + response.status(),
  );
  return expected === 204 ? null : (await response.json()).data;
}
async function stable(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !document.querySelector(".skeleton"));
}
async function snap(page, name, widths = [1440, 390]) {
  for (const width of [...new Set([...widths, 768, 360])]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await stable(page);
    await page.screenshot({
      path: path.join(out, `${name}-${width}.png`),
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert.equal(overflow, false, `${name} overflow at ${width}`);
    report.screenshots.push(`${name}-${width}.png`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function login(page, who) {
  await page.goto(origin + "/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(who);
  await page.getByLabel("Пароль", { exact: true }).fill(config.DEMO_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL(/\/(my|staff)$/);
  await stable(page);
}
async function transition(page, label, comment) {
  const detail = page
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: label }) });
  await detail.locator("summary").click();
  if (comment)
    await detail.locator("textarea[name=publicComment]").fill(comment);
  const wait = page.waitForResponse(
    (r) => r.url().endsWith("/status") && r.request().method() === "POST",
  );
  await detail
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  assert.equal((await wait).status(), 200);
  await stable(page);
}
(async () => {
  const png = await validPngPromise;
  const browser = await chromium.launch({ headless: true });
  try {
    const citizen = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await citizen.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    report.citizenEmail = email;
    if (!process.env.SEVENS_RESUME_ID) {
      await page.goto(origin);
      await page
        .locator(".landing-scene img")
        .waitFor({ timeout: 30000 });
      await page.waitForFunction(() => {
        const image = document.querySelector(".landing-scene img");
        return image?.complete && image.naturalWidth > 0;
      });
      assert.equal(
        await page.locator(".landing-scene img").getAttribute("src"),
        "/sevens/city-illustration.png",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "3D-модель", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .locator(".landing-model-toggle, .landing-scene canvas, .landing-scene .city-experience")
          .count(),
        0,
      );
      const sceneDecoration = await page.locator(".landing-scene").evaluate(
        (scene) => getComputedStyle(scene, "::before").content,
      );
      assert.ok(
        ["none", "normal"].includes(sceneDecoration),
        "Home illustration has no decorative circle",
      );
      await snap(page, "home", [1440, 768, 390]);
      assert.equal(
        await page
          .getByText("Режим данных: демо-mock", { exact: false })
          .count(),
        0,
      );
      check(
        "Home loaded illustration, no 3D model or decorative circle, responsive layouts",
      );
      await page.goto(origin);
      await page.locator('[data-marker="ecology"]').click();
      await page.getByText("Больше тени на набережной", { exact: true }).waitFor();
      check("Scene direction buttons update example");
      await page.goto(origin + "/login");
      await snap(page, "login");
      await page.goto(origin + "/register");
      await snap(page, "register");
      await page
        .getByLabel("Имя и фамилия", { exact: true })
        .fill("Проверочный житель Sevens");
      await page.getByLabel("Электронная почта", { exact: true }).fill(email);
      await page
        .getByLabel("Пароль", { exact: true })
        .fill(config.DEMO_PASSWORD);
      await page
        .getByRole("button", { name: "Зарегистрироваться", exact: true })
        .click();
      await page.waitForURL(origin + "/my");
      await snap(page, "my-empty");
      check("Citizen registration through real UI");
      await page.goto(origin + "/ideas/new");
      await page.getByRole("button", { name: "Далее", exact: true }).click();
      await page
        .getByText("Название короче 10 символов", { exact: true })
        .waitFor();
      await snap(page, "wizard-errors", [390]);
      check("Inline validation and keyboard focus");
      await page.getByLabel("Название идеи", { exact: true }).fill(title);
      await page
        .getByLabel("Что сейчас неудобно? (проблема)", { exact: true })
        .fill(
          "Возле школы детям трудно переходить дорогу. Вечером не хватает освещения, а водители плохо замечают пешеходов.",
        );
      await page
        .getByLabel("Что предлагаете изменить? (решение)", { exact: true })
        .fill(
          "Установить умный светофор, датчики движения и дополнительное освещение перехода рядом со школой.",
        );
      await snap(page, "wizard-step1");
      await page.getByRole("button", { name: "Далее", exact: true }).click();
      await page
        .getByLabel("Населённый пункт / территория", { exact: true })
        .waitFor();
      await page.waitForURL(/draft=/);
      report.ideaId = new URL(page.url()).searchParams.get("draft");
      assert.ok(report.ideaId);
      await page
        .getByLabel("Населённый пункт / территория", { exact: true })
        .selectOption({ label: "Семей" });
      await page
        .getByLabel("Уточните место (необязательно)", { exact: true })
        .fill("Семей, переход у школы. Пример места для проверки сервиса.");
      await page.locator("#files").setInputFiles([
        { name: "crossing.png", mimeType: "image/png", buffer: png },
        { name: "lighting.png", mimeType: "image/png", buffer: png },
      ]);
      await page.getByText("Осталось мест: 1.", { exact: true }).waitFor();
      check("Two sequential files upload without stale version");
      await page
        .getByRole("button", { name: "Сохранить черновик", exact: true })
        .click();
      await stable(page);
      let draft = await api(citizen, "GET", `/api/v1/ideas/${report.ideaId}`);
      assert.equal(draft.attachments.length, 2);
      await api(citizen, "PATCH", `/api/v1/ideas/${report.ideaId}`, {
        expectedVersion: draft.version,
        locationGeometry: zone,
      });
      await page.reload();
      await page.getByLabel("Название идеи", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Далее", exact: true }).click();
      await stable(page);
      assert.ok(
        (await page.locator(".location-map__selection").innerText()).includes(
          "Зона",
        ),
      );
      await snap(page, "wizard-step2");
      check("Draft polygon and attachments restored from server");
      await page.getByRole("button", { name: "Далее", exact: true }).click();
      await page
        .getByText("Проверка перед отправкой", { exact: true })
        .waitFor();
      await snap(page, "wizard-step3");
      await page.getByRole("checkbox").check();
      await page
        .getByRole("button", { name: "Отправить идею", exact: true })
        .click();
      await page
        .getByRole("link", { name: "Открыть идею", exact: true })
        .waitFor();
      await snap(page, "submission-success");
      let idea = await api(citizen, "GET", `/api/v1/ideas/${report.ideaId}`);
      report.publicNumber = idea.publicNumber;
      assert.equal(idea.status, "RECEIVED");
      assert.equal(idea.effectiveCategoryCode, "TRANSPORT");
      assert.deepEqual(idea.locationGeometry, zone);
      check("Submit saves location/files and routes TRANSPORT");
      await page
        .getByRole("link", { name: "Открыть идею", exact: true })
        .click();
      await page.waitForURL(origin + `/ideas/${report.ideaId}`);
      await snap(page, "citizen-received");
    } else {
      report.ideaId = process.env.SEVENS_RESUME_ID;
      await login(page, email);
      const resumed = await api(
        citizen,
        "GET",
        `/api/v1/ideas/${report.ideaId}`,
      );
      report.publicNumber = resumed.publicNumber;
      check("Resume verified submitted record", report.publicNumber);
      await page.goto(origin + `/ideas/${report.ideaId}`);
      await snap(page, "citizen-received");
    }
    const staff = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const staffPage = await staff.newPage();
    staffPage.on("dialog", (d) => d.accept());
    staffPage.on("pageerror", (e) => report.errors.push(e.message));
    await login(staffPage, "transport@example.test");
    await snap(staffPage, "staff-queue", [1440, 768, 390]);
    await staffPage
      .getByLabel("Поиск по номеру или тексту", { exact: true })
      .fill(report.publicNumber);
    await staffPage
      .getByRole("button", { name: "Применить фильтры", exact: true })
      .click();
    await staffPage.waitForURL(
      (url) => url.searchParams.get("q") === report.publicNumber,
    );
    await stable(staffPage);
    await staffPage
      .getByRole("link", { name: `Открыть карточку: ${report.publicNumber}`, exact: true })
      .click();
    await staffPage.waitForURL(
      (url) => url.pathname === `/staff/${report.ideaId}`,
    );
    await stable(staffPage);
    await staffPage
      .locator("#assignee")
      .selectOption({ label: "Демо-сотрудник: transport" });
    const assigned = staffPage.waitForResponse(
      (r) => r.url().endsWith("/assignment") && r.request().method() === "POST",
    );
    await staffPage
      .getByRole("button", { name: "Сохранить назначение", exact: true })
      .click();
    assert.equal((await assigned).status(), 200);
    await stable(staffPage);
    check("Queue filtering and assignment");
    await transition(staffPage, "Взять на рассмотрение");
    await staffPage
      .getByLabel("Публичный ответ жителю", { exact: true })
      .fill(publicText);
    const publicResponse = staffPage.waitForResponse(
      (r) => r.url().endsWith("/comments") && r.request().method() === "POST",
    );
    await staffPage
      .getByRole("button", { name: "Отправить ответ", exact: true })
      .click();
    assert.equal((await publicResponse).status(), 201);
    await stable(staffPage);
    await staffPage
      .getByLabel("Заметка для коллег", { exact: true })
      .fill(internalText);
    const noteResponse = staffPage.waitForResponse(
      (r) => r.url().endsWith("/comments") && r.request().method() === "POST",
    );
    await staffPage
      .getByRole("button", { name: "Сохранить заметку", exact: true })
      .click();
    assert.equal((await noteResponse).status(), 201);
    await stable(staffPage);
    check("PUBLIC reply and INTERNAL note use separate forms");
    await snap(staffPage, "staff-detail", [1440, 768, 390]);
    await transition(
      staffPage,
      "Запросить уточнение",
      "Уточните, пожалуйста, с какой стороны дороги нужен дополнительный свет у перехода.",
    );
    await page.reload();
    await page
      .getByLabel("Ваш ответ", { exact: true })
      .fill(
        "Дополнительное освещение требуется с северной стороны перехода возле входа в школу.",
      );
    await page
      .getByRole("button", { name: "Отправить ответ", exact: true })
      .click();
    await stable(page);
    await page
      .getByText("Вопрос специалиста", { exact: true })
      .waitFor({ state: "hidden" });
    check("NEEDS_INFO and citizen clarification through UI");
    await citizen.clearCookies();
    await login(page, email);
    await page.goto(origin + `/ideas/${report.ideaId}`);
    await stable(page);
    assert.ok((await page.locator("main").innerText()).includes(publicText));
    assert.ok(!(await page.locator("main").innerText()).includes(internalText));
    const finalIdea = await api(
      citizen,
      "GET",
      `/api/v1/ideas/${report.ideaId}`,
    );
    assert.deepEqual(finalIdea.locationGeometry, zone);
    const timeline = await api(
      citizen,
      "GET",
      `/api/v1/ideas/${report.ideaId}/timeline`,
    );
    assert.ok(timeline.some((e) => e.body === publicText));
    assert.ok(!JSON.stringify(timeline).includes(internalText));
    assert.ok(!JSON.stringify(finalIdea).includes(internalText));
    await snap(page, "citizen-reply", [1440, 768, 390]);
    check("New sign-in retains geometry and PUBLIC; INTERNAL absent in API/UI");
    await page.goto(origin + "/notifications");
    await snap(page, "notifications");
    assert.ok(await page.locator('main a[href^="/ideas/"]').count());
    check("Notifications link to idea");
    await page.goto(origin + "/my");
    await snap(page, "my-ideas");
    await staffPage
      .getByRole("link", { name: "Вернуться в очередь", exact: false })
      .click();
    await staffPage.waitForURL((url) => url.pathname === "/staff");
    await stable(staffPage);
    assert.equal(
      new URL(staffPage.url()).searchParams.get("q"),
      report.publicNumber,
    );
    check("Queue context survives detail return");
    check("Console has no uncaught errors", report.errors);
    assert.equal(report.errors.length, 0);
    report.pass = true;
  } catch (error) {
    report.pass = false;
    report.failure = error.message;
    process.exitCode = 1;
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(out, "browser-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          pass: report.pass,
          checks: report.checks.length,
          screenshots: report.screenshots.length,
          ideaId: report.ideaId,
          publicNumber: report.publicNumber,
          failure: report.failure,
        },
        null,
        2,
      ),
    );
  }
})();
