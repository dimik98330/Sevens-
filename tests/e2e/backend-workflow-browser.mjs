// Narrow browser regression for the stricter staff clarification contract.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const config=parseEnv(readFileSync('.data/backend-verification/release.env','utf8'));
if(config.POSTGRES_DB!=='sevens_backend_test'||config.APP_ENV!=='demo')throw new Error('Expected isolated release environment');
const base=config.APP_ORIGIN;
const request=async(method,url,auth,body)=>{
  const response=await fetch(base+url,{method,headers:{origin:base,
    ...(auth?{cookie:auth.cookie,'x-csrf-token':auth.csrf}:{}),
    ...(body?{'content-type':'application/json','idempotency-key':randomUUID()}:{}),
  },...(body?{body:JSON.stringify(body)}:{})});
  const payload=await response.json();
  assert.ok(response.ok,JSON.stringify({method,url,status:response.status,payload}));
  return {data:payload.data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
};
const signIn=async(email)=>{
  const result=await request('POST','/api/v1/auth/login',null,{email,password:config.DEMO_PASSWORD});
  return {cookie:result.cookie,csrf:result.data.csrfToken,user:result.data.user};
};
const author=await signIn('citizen1@example.test'),staff=await signIn('transport@example.test');
const catalogs=(await request('GET','/api/v1/catalogs')).data;
const draft=(await request('POST','/api/v1/ideas',author,{
  title:'Умные светофоры — проверка возврата из уточнения',
  problem:'У школы дорога и светофоры требуют цифрового контроля безопасности перехода.',
  solution:'Установить умные светофоры и датчики загруженности дороги возле школы.',
  requestedCategoryCode:null,territoryId:catalogs.territories[0].id,
})).data;
let card=(await request('POST',`/api/v1/ideas/${draft.id}/submit`,author,{expectedVersion:draft.version,consentAccepted:true})).data;
card=(await request('POST',`/api/v1/ideas/${draft.id}/status`,staff,{expectedVersion:card.version,toStatus:'UNDER_REVIEW',takeOwnership:true})).data;
card=(await request('POST',`/api/v1/ideas/${draft.id}/status`,staff,{expectedVersion:card.version,toStatus:'NEEDS_INFO',publicComment:'Уточните, пожалуйста, нужное расположение датчиков возле школы.'})).data;
const browser=await chromium.launch({headless:true});
const reason='Уточнение отменено: специалист нашёл необходимые сведения и продолжает рассмотрение.';
const report={pass:false,scenario:'Staff NEEDS_INFO -> UNDER_REVIEW requires and preserves public reason',origin:base,ideaId:draft.id};
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('dialog',(dialog)=>dialog.accept());
  await page.goto(base+'/login');
  await page.getByLabel('Email',{exact:true}).fill('transport@example.test');
  await page.getByLabel('Пароль',{exact:true}).fill(config.DEMO_PASSWORD);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await page.waitForURL(/\/staff$/);
  await page.goto(base+`/staff/${draft.id}`);
  const action=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Взять на рассмотрение'})});
  await action.locator('summary').click();
  const field=action.locator('textarea[name=publicComment]');
  await field.waitFor(); assert.equal(await field.getAttribute('required'),'');
  await field.fill(reason);
  const changed=page.waitForResponse((response)=>response.url().endsWith('/status')&&response.request().method()==='POST');
  await action.getByRole('button',{name:'Подтвердить',exact:true}).click();
  assert.equal((await changed).status(),200);
  const timeline=(await request('GET',`/api/v1/ideas/${draft.id}/timeline`,author)).data;
  assert.ok(timeline.some((event)=>event.body===reason));
  const result=(await request('GET',`/api/v1/ideas/${draft.id}`,author)).data;
  assert.equal(result.status,'UNDER_REVIEW');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'docs/design/screenshots/backend-release/staff-resume-390.png',fullPage:true});
  report.pass=true;
} catch(error) {report.failure=error.message;process.exitCode=1;}
finally {
  await browser.close();
  writeFileSync('.data/backend-verification/manual-resume-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
