// Real sessions, isolated PostgreSQL engine; no live DB resets or paid calls.
import { before,after,it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed,uuidFromSeedKey } from '../../../scripts/seed.mjs';
import { createServer } from '../../../src/server/http/app.mjs';
import { demoLoginEnabled } from '../../../src/server/auth/demo.mjs';

const ORIGIN='http://localhost:3000';let db,server,disabledServer,base,disabledBase,uploadDir;
before(async()=>{
  db=await openDatabase({databaseUrl:null,pgliteDir:null});await migrate(db);
  await seed(db,{demoPassword:'b11-synthetic-test-password'});
  uploadDir=await mkdtemp(path.join(tmpdir(),'sevens-demo-login-'));
  const config={origin:ORIGIN,secureCookies:false,uploadDir,logRequests:false};
  server=createServer(db,{...config,demoLoginEnabled:true});
  disabledServer=createServer(db,{...config,demoLoginEnabled:false});
  for(const s of [server,disabledServer])await new Promise(r=>s.listen(0,'127.0.0.1',r));
  base=`http://127.0.0.1:${server.address().port}`;
  disabledBase=`http://127.0.0.1:${disabledServer.address().port}`;
});
after(async()=>{
  for(const s of [server,disabledServer]){s?.closeAllConnections();if(s?.listening)await new Promise(r=>s.close(r));}
  await db?.close();
  if(uploadDir){const p=path.resolve(uploadDir);assert.ok(p.startsWith(path.resolve(tmpdir())+path.sep));
    assert.ok(path.basename(p).startsWith('sevens-demo-login-'));await rm(p,{recursive:true,force:true});}
});
async function request(method,pathname,{body,auth,origin=ORIGIN,url=base}={}){
  const headers={origin};if(auth?.cookie)headers.cookie=auth.cookie;if(auth?.csrf)headers['x-csrf-token']=auth.csrf;
  if(body!==undefined)headers['content-type']='application/json';
  if(method!=='GET')headers['idempotency-key']=randomUUID();
  const response=await fetch(url+pathname,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const json=response.status===204?null:await response.json();return {response,json};
}
function auth(result){return {cookie:result.response.headers.get('set-cookie')?.split(';')[0],csrf:result.json.data.csrfToken};}

it('public shortcut requires both explicit flag and a demo/test environment',()=>{
  assert.equal(demoLoginEnabled({APP_ENV:'demo',DEMO_LOGIN_ENABLED:'true'}),true);
  assert.equal(demoLoginEnabled({APP_ENV:'test',DEMO_LOGIN_ENABLED:'true',NODE_ENV:'production'}),true);
  for(const env of [{APP_ENV:'production',DEMO_LOGIN_ENABLED:'true'},{APP_ENV:'demo'},
    {DEMO_LOGIN_ENABLED:'true'},{APP_ENV:'demo',DEMO_LOGIN_ENABLED:'false'}])assert.equal(demoLoginEnabled(env),false);
});
it('disabled capabilities contain no credentials and POST stays unavailable',async()=>{
  const capability=await request('GET','/api/v1/auth/demo',{url:disabledBase});
  assert.deepEqual(capability.json.data,{enabled:false});
  assert.equal((await request('POST','/api/v1/auth/demo',{url:disabledBase,body:{role:'STAFF'}})).response.status,404);
});
it('citizen shortcut creates HttpOnly session and enables normal authenticated writes',async()=>{
  const capability=await request('GET','/api/v1/auth/demo');assert.deepEqual(capability.json.data,{enabled:true});
  const login=await request('POST','/api/v1/auth/demo',{body:{role:'CITIZEN'}});
  assert.equal(login.response.status,200);assert.equal(login.json.data.user.role,'CITIZEN');
  assert.match(login.response.headers.get('set-cookie'),/HttpOnly/);assert.ok(login.json.meta.requestId);
  assert.equal(JSON.stringify(login.json).includes('password'),false);
  const session=auth(login);
  const me=await request('GET','/api/v1/auth/me',{auth:session});
  assert.equal(me.json.data.id,uuidFromSeedKey('user:citizen1'));assert.equal(me.json.data.csrfToken,session.csrf);
  const draft=await request('POST','/api/v1/ideas',{auth:session,body:{title:'Демо-идея после быстрого входа'}});
  assert.equal(draft.response.status,201);
  assert.equal((await request('GET','/api/v1/ideas?scope=staff',{auth:session})).response.status,403);
});
it('existing account switch requires CSRF, replaces role and revokes only the old session',async()=>{
  const citizen=auth(await request('POST','/api/v1/auth/demo',{body:{role:'CITIZEN'}}));
  const denied=await request('POST','/api/v1/auth/demo',{body:{role:'STAFF'},auth:{cookie:citizen.cookie}});
  assert.equal(denied.response.status,403);assert.equal(denied.json.error.code,'CSRF_INVALID');
  const staff=await request('POST','/api/v1/auth/demo',{body:{role:'STAFF'},auth:citizen});
  assert.equal(staff.response.status,200);assert.equal(staff.json.data.user.role,'STAFF');
  const staffAuth=auth(staff);assert.notEqual(staffAuth.cookie,citizen.cookie);
  assert.equal((await request('GET','/api/v1/auth/me',{auth:citizen})).response.status,401);
  const me=await request('GET','/api/v1/auth/me',{auth:staffAuth});
  assert.equal(me.json.data.id,uuidFromSeedKey('user:staff_transport'));
  assert.equal((await request('GET','/api/v1/ideas?scope=staff',{auth:staffAuth})).response.status,200);
});
it('cannot select admin, arbitrary identities, unknown fields or an untrusted Origin',async()=>{
  for(const body of [{role:'ADMIN'},{role:'STAFF',email:'admin@example.test'},
    {role:'CITIZEN',userId:uuidFromSeedKey('user:admin')},{role:'staff'}]){
    const result=await request('POST','/api/v1/auth/demo',{body});assert.equal(result.response.status,400);
  }
  assert.equal((await request('POST','/api/v1/auth/demo',{body:{role:'STAFF'},origin:'https://untrusted.example'})).response.status,403);
});
it('inactive seeded user or non-demo staff organization cannot create a session',async()=>{
  const id=uuidFromSeedKey('user:staff_transport');
  const sessionCount=async()=>(await db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n;
  const beforeCount=await sessionCount();
  await db.query('UPDATE users SET active=false WHERE id=$1',[id]);
  try{assert.equal((await request('POST','/api/v1/auth/demo',{body:{role:'STAFF'}})).response.status,503);}
  finally{await db.query('UPDATE users SET active=true WHERE id=$1',[id]);}
  await db.query("UPDATE organizations SET is_demo=false WHERE code='DEMO_TRANSPORT'");
  try{assert.equal((await request('POST','/api/v1/auth/demo',{body:{role:'STAFF'}})).response.status,503);}
  finally{await db.query("UPDATE organizations SET is_demo=true WHERE code='DEMO_TRANSPORT'");}
  assert.equal(await sessionCount(),beforeCount);
});
