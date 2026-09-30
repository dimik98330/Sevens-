// Own Compose project/volumes only. Existing .env and preview stands are preserved.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, readFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { waitForReady } from './readiness.mjs';

const root=process.cwd(), project='sevens-backend-release';
const folder=path.join(root,'.data/backend-verification');
const envFile=path.join(folder,'release.env');
mkdirSync(folder,{recursive:true});
let config;
if (existsSync(envFile)) config=parseEnv(readFileSync(envFile,'utf8'));
else {
  const probe=createServer();
  await new Promise((resolve) => probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const dbPassword=randomBytes(24).toString('hex');
  config={APP_ENV:'demo',APP_ORIGIN:`http://127.0.0.1:${port}`,APP_PORT:String(port),
    APP_ENV_FILE:envFile.replaceAll('\\','/'),POSTGRES_DB:'sevens_backend_test',POSTGRES_USER:'sevens_backend_test',
    POSTGRES_PASSWORD:dbPassword,DATABASE_URL:`postgresql://sevens_backend_test:${dbPassword}@db:5432/sevens_backend_test`,
    DEMO_PASSWORD:randomBytes(24).toString('hex'),UPLOAD_DIR:'/app/storage/uploads',
    API_INTERNAL_URL:'http://api:18080',COOKIE_SECURE:'false',DEMO_MODE:'true',AI_ENABLED:'false',
    API_PROXY_SECRET:randomBytes(24).toString('hex'),BRIDGE_CLIENT_IP_HEADER:'',LOG_LEVEL:'info',NEXT_PUBLIC_ABAI_MOCK:'0'};
  writeFileSync(envFile,Object.entries(config).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
}
if (config.POSTGRES_DB!=='sevens_backend_test'||config.APP_ENV!=='demo') throw new Error('Refusing unrelated release environment');
const compose=['compose','-p',project,'--env-file',envFile];
const args=process.argv.slice(2);
if(args.some((arg)=>arg!=='--skip-build'))throw new Error('Only --skip-build is supported');
async function run(command,args,env={},logFile) {
  const fd=logFile?openSync(logFile,'w'):null;
  const child=spawn(command,args,{cwd:root,env:{...process.env,...(command==='docker'?config:{}),...env},windowsHide:true,
    stdio:fd===null?['ignore','pipe','pipe']:['ignore',fd,fd]});
  let output='';
  if (fd===null) {
    child.stdout.on('data',(chunk)=>{output+=chunk.toString();});
    child.stderr.on('data',(chunk)=>{output+=chunk.toString();});
  }
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  if(fd!==null)closeSync(fd);
  if(code!==0) {
    if(!logFile)writeFileSync(path.join(folder,'release-failure.log'),output+'\n');
    throw new Error(`${command} verification failed (${code}); inspect ${logFile?path.relative(root,logFile):'.data/backend-verification/release-failure.log'}`);
  }
  return output.trim();
}
const waitReady=()=>waitForReady(config.APP_ORIGIN+'/api/health/ready');
console.log(JSON.stringify({stage:'building',project,origin:config.APP_ORIGIN}));
await run('docker',[...compose,'up',...(args.includes('--skip-build')?[]:['--build']),'-d'],{},path.join(folder,'release-build.log'));
await waitReady();
console.log(JSON.stringify({stage:'HTTP smoke',project}));
const smokeEnv={SMOKE_BASE:config.APP_ORIGIN,SMOKE_PASSWORD:config.DEMO_PASSWORD};
const smokeText=await run(process.execPath,['tests/e2e/backend-bridge.mjs'],smokeEnv);
writeFileSync(path.join(folder,'release-smoke.log'),smokeText+'\n');
const result=JSON.parse(smokeText.split('\n').findLast((line)=>line.trim().startsWith('{')));
await run('docker',[...compose,'restart','db','api','app'],{},path.join(folder,'release-restart.log'));
await waitReady();
const persisted=await run(process.execPath,['tests/e2e/backend-bridge.mjs'],{
  ...smokeEnv,SMOKE_MODE:'verify',SMOKE_EMAIL:result.email,SMOKE_ID:result.ideaId,
  SMOKE_ATTACHMENT_ID:result.attachmentId,
});
writeFileSync(path.join(folder,'release-persistence.log'),persisted+'\n');
const report={status:'PASS',project,origin:config.APP_ORIGIN,smoke:result,
  persistence:JSON.parse(persisted.split('\n').findLast((line)=>line.trim().startsWith('{')))};
writeFileSync(path.join(folder,'release-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',project,origin:config.APP_ORIGIN,report:'.data/backend-verification/release-report.json'}));
