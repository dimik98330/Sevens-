// Isolated local preview. Never touches existing Compose stacks or volumes.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { parseEnv } from "node:util";
const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
// Refuse duplicate preview starts before bootstrap can touch the local catalog.
// An already running preview keeps its API, sessions and PostgreSQL unchanged.
for (const port of [3100, 18081]) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => {
      reject(new Error(error.code === "EADDRINUSE"
        ? `Порт ${port} уже занят. Используйте работающий Sevens или остановите его перед новым запуском.`
        : `Не удалось проверить порт ${port}: ${error.code}`));
    });
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => probe.close(resolve));
  });
}
const envFile = path.join(root, ".env.sevens");
const dbEnv = path.join(root, ".data/sevens-postgres.env");
mkdirSync(path.dirname(dbEnv), { recursive: true });
if (!existsSync(envFile)) {
  const password = randomBytes(20).toString("hex");
  const demo = randomBytes(18).toString("hex");
  writeFileSync(
    envFile,
    [
      `DATABASE_URL=postgresql://sevens:${password}@127.0.0.1:5436/sevens`,
      "APP_ENV=demo",
      "APP_ORIGIN=http://127.0.0.1:3100",
      "APP_PORT=3100",
      "API_HOST=127.0.0.1",
      "API_PORT=18081",
      "API_INTERNAL_URL=http://127.0.0.1:18081",
      "API_BOOTSTRAP=true",
      "COOKIE_SECURE=false",
      "DEMO_MODE=true",
      `DEMO_PASSWORD=${demo}`,
      "UPLOAD_DIR=./.data/sevens-uploads",
      "AI_ENABLED=false",
    ].join("\n") + "\n",
    { flag: "wx" },
  );
  writeFileSync(
    dbEnv,
    `POSTGRES_DB=sevens\nPOSTGRES_USER=sevens\nPOSTGRES_PASSWORD=${password}\n`,
    { flag: "wx" },
  );
}
const existing = execFileSync(
  "docker",
  ["ps", "-a", "--filter", "name=^sevens-design-db$", "--format", "{{.Names}}"],
  { encoding: "utf8" },
).trim();
if (!existing) {
  if (!existsSync(dbEnv))
    throw Error("Local database settings missing: .data/sevens-postgres.env");
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      "sevens-design-db",
      "--env-file",
      dbEnv,
      "-p",
      "127.0.0.1:5436:5432",
      "-v",
      "sevens-design-pg:/var/lib/postgresql/data",
      "postgres:17",
    ],
    { stdio: "pipe" },
  );
} else execFileSync("docker", ["start", "sevens-design-db"], { stdio: "pipe" });
let ready = false;
for (let i = 0; i < 30; i++) {
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "sevens-design-db",
        "pg_isready",
        "-U",
        "sevens",
        "-d",
        "sevens",
      ],
      { stdio: "pipe" },
    );
    ready = true;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!ready) throw Error("Sevens PostgreSQL is not ready");
execFileSync(process.execPath, ["scripts/build-routing.mjs"], {
  stdio: "inherit",
});
// Next loads .env too, so an optional public map key there remains available.
// Values from .env.sevens take precedence for the isolated API and database.
const children = [];
const previewEnv = {
  ...process.env,
  ...parseEnv(readFileSync(envFile, "utf8")),
  NEXT_PUBLIC_ABAI_MOCK: "0",
};
const productionPreview = process.argv.includes("--production");
function run(args, overrides = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...previewEnv, ...overrides },
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  return child;
}
run(["scripts/serve.mjs"]);
let apiReady = false;
for (let i = 0; i < 40; i++) {
  try {
    apiReady = (await fetch("http://127.0.0.1:18081/api/health/ready")).ok;
    if (apiReady) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!apiReady) {
  children.forEach((c) => c.kill());
  throw Error("Sevens API did not become ready");
}
let web;
if (productionPreview) {
  const buildDirectory = process.env.SEVENS_BUILD_DIR || ".next";
  const standalone = path.join(root, buildDirectory, "standalone");
  if (!existsSync(path.join(standalone, "server.js")))
    throw Error("Сначала выполните npm run build");
  mkdirSync(path.join(standalone, buildDirectory), { recursive: true });
  cpSync(path.join(root, buildDirectory, "static"), path.join(standalone, buildDirectory, "static"), {
    recursive: true,
    force: true,
  });
  cpSync(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
    force: true,
  });
  web = run([path.join(standalone, "server.js")], {
    NODE_ENV: "production",
    PORT: "3100",
    HOSTNAME: "127.0.0.1",
  });
} else {
  web = run([
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ]);
}
console.log(
  `Sevens ${productionPreview ? "built preview" : "development preview"}: http://127.0.0.1:3100 — isolated PostgreSQL 17, data retained on stop.`,
);
const stop = () => {
  for (const child of children) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
web.on("exit", (code) => {
  stop();
  process.exitCode = code ?? 0;
});
