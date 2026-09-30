import { readFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import path from 'node:path';
const config=parseEnv(readFileSync('.data/backend-verification/release.env','utf8'));
if(config.POSTGRES_DB!=='sevens_backend_test'||config.APP_ENV!=='demo') throw new Error('Expected isolated backend release');
const out=path.resolve('docs/design/screenshots/backend-release');
mkdirSync(out,{recursive:true});
const child=spawn(process.execPath,['tests/e2e/sevens-browser.cjs'],{
  windowsHide:true,stdio:'inherit',env:{...process.env,SMOKE_BASE:config.APP_ORIGIN,
    SMOKE_PASSWORD:config.DEMO_PASSWORD,SEVENS_BROWSER_OUT:out},
});
child.on('error',()=>{process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code??1;});
