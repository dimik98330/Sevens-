import { spawn } from 'node:child_process';
if (!process.env.BACKEND_PG_TEST_URL) throw new Error('BACKEND_PG_TEST_URL is required; use scripts/backend-test-db.mjs for an isolated database');
const child = spawn(process.execPath,['--test','tests/integration/postgres/backend-concurrency.test.mjs'],{
  stdio:'inherit',windowsHide:true,
});
child.on('error',() => { process.exitCode=1; });
child.on('exit',(code) => { process.exitCode=code ?? 1; });
