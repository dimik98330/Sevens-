// Browser buttons -> real session -> intended cabinet. No passwords or model calls.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.DEMO_LOGIN_BASE || 'http://127.0.0.1:3100';
const folder=path.resolve('.data/classifier-verification/demo-browser');fs.mkdirSync(folder,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const checks=[];
  try{
    await page.goto(base+'/login');
    const resident=page.getByRole('button',{name:'Житель',exact:true});
    const staff=page.getByRole('button',{name:'Представитель акимата',exact:true});
    await resident.waitFor({state:'visible',timeout:20000});await staff.waitFor({state:'visible'});
    await page.screenshot({path:path.join(folder,'login-1440.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(folder,'login-390.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await resident.click();await page.waitForURL('**/my',{timeout:15000});
    const citizen=await(await context.request.get(base+'/api/v1/auth/me')).json();
    assert.equal(citizen.data.role,'CITIZEN');checks.push('Resident button opens /my with real CITIZEN session');
    const citizenCookie=(await context.cookies()).find(c=>c.name==='sid');
    assert.equal(citizenCookie?.httpOnly,true);
    await page.screenshot({path:path.join(folder,'resident-390.png'),fullPage:true});
    // Current auth pages redirect an already signed-in user to their cabinet.
    await page.locator('.workspace-logout').click();
    await page.waitForURL(base+'/',{timeout:15000});
    await page.goto(base+'/login');
    await staff.waitFor({state:'visible'});await staff.click();
    await page.waitForURL('**/staff',{timeout:15000});
    const representative=await(await context.request.get(base+'/api/v1/auth/me')).json();
    assert.equal(representative.data.role,'STAFF');checks.push('Akimat button opens /staff with real STAFF session after ordinary logout');
    assert.notEqual((await context.cookies()).find(c=>c.name==='sid')?.value,citizenCookie.value);
    await page.screenshot({path:path.join(folder,'staff-390.png'),fullPage:true});
    assert.equal(errors.length,0);checks.push('No page errors or mobile horizontal overflow');
    const report={status:'PASS',origin:base,checks,viewports:[1440,390],pageErrors:errors};
    fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }finally{await browser.close();}
})().catch(error=>{console.error(JSON.stringify({status:'FAIL',error:error.message}));process.exitCode=1;});
