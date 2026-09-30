import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticClassifier, semanticPayload, minimizedText, validateSemanticResult } from '../../../src/server/routing/semantic.mjs';

const input={title:'Умные светофоры у школы',problem:'Нет светофора возле школы, детям трудно перейти дорогу.',solution:'Установить умные светофоры и датчики возле школы.'};
const output={detectedCategoryCode:'TRANSPORT',secondaryCategories:['SAFETY'],confidenceBand:'HIGH',needsReview:false,digitalComponent:true,
  explanation:'Предлагается установить умные светофоры и улучшить безопасность дорожного движения.',
  evidence:[{field:'solution',quote:'Установить умные светофоры',kind:'SUPPORT'}]};

it('same text reuses one provider call across territory/category choices and simultaneous requests',async()=>{
  let calls=0;
  const classifier=createSemanticClassifier({localEnabled:false,enabled:true,apiKey:'test-only',provider:async()=>{calls++;await new Promise((r)=>setTimeout(r,15));return output;}});
  const [a,b]=await Promise.all([classifier.prepare(input),classifier.prepare({...input,requestedCategoryCode:'ECOLOGY',territoryId:'other'})]);
  assert.equal(calls,1);assert.equal(a.status,'READY');assert.deepEqual(a,b);
  await classifier.prepare(input);assert.equal(calls,1);
});

it('invalid category, unknown fields and fabricated quotes never become an accepted semantic result',async()=>{
  for(const value of [{...output,detectedCategoryCode:'ADMIN'}, {...output,organizationId:'hack'},
    {...output,evidence:[{field:'solution',quote:'несуществующий фрагмент',kind:'SUPPORT'}]}, {...output,evidence:[]}]){
    const classifier=createSemanticClassifier({localEnabled:false,enabled:true,apiKey:'test-only',provider:async()=>value});
    assert.equal((await classifier.prepare(input)).status,'FALLBACK');
  }
});

it('bounded deadline falls back even when an injected provider ignores abort',async()=>{
  const classifier=createSemanticClassifier({localEnabled:false,enabled:true,apiKey:'test-only',deadlineMs:20,provider:()=>new Promise(()=>{})});
  const started=Date.now();const value=await classifier.prepare(input);
  assert.equal(value.status,'FALLBACK');assert.ok(Date.now()-started<500);
});

it('busy and hourly budget limits do not make more paid requests',async()=>{
  let release,calls=0;
  const classifier=createSemanticClassifier({localEnabled:false,enabled:true,apiKey:'test-only',maxConcurrent:1,maxCallsPerHour:1,
    provider:()=>{calls++;return new Promise((r)=>{release=()=>r(output);});}});
  const first=classifier.prepare(input);
  assert.equal((await classifier.prepare({...input,title:'Другая идея для теста'})).reason,'CLASSIFIER_BUSY');
  release();assert.equal((await first).status,'READY');
  assert.equal((await classifier.prepare({...input,title:'Третья идея для теста'})).reason,'CLASSIFIER_BUDGET_LIMIT');
  assert.equal(calls,1);
});

it('payload contains only minimized text, no tools, no external URLs and no stored conversation',()=>{
  const text={...input,problem:'Напишите test@example.test или +7 777 123 45 67. Предлагаю светофор.'};
  const payload=semanticPayload(text);
  assert.equal(payload.store,false);assert.equal(payload.tools,undefined);
  assert.equal(payload.text.format.strict,true);
  assert.equal(payload.input.includes('test@example.test'),false);assert.equal(payload.input.includes('777 123'),false);
  assert.equal(minimizedText(text).locationText,undefined);
});

it('disabled or missing-key configuration produces local fallback without contacting a provider',async()=>{
  let calls=0;
  const classifier=createSemanticClassifier({localEnabled:false,enabled:false,apiKey:'test-only',provider:()=>{calls++;return output;}});
  assert.equal((await classifier.prepare(input)).reason,'CLASSIFIER_DISABLED');assert.equal(calls,0);
});

it('quote validation accepts formatting differences, not paraphrases',()=>{
  assert.equal(validateSemanticResult({...output,evidence:[{field:'solution',quote:'установить  умные светофоры',kind:'SUPPORT'}]},input).detectedCategoryCode,'TRANSPORT');
});

it('API-only mode never loads the optional local model after a provider failure',async()=>{
  let localCalls=0;
  const classifier=createSemanticClassifier({enabled:true,apiKey:'test-only',mode:'llm',localEnabled:true,
    provider:async()=>{throw new Error('unavailable');},localProvider:async()=>{localCalls++;return output;}});
  assert.equal((await classifier.prepare(input)).status,'FALLBACK');assert.equal(localCalls,0);
});

it('shared paid admission is checked only on uncached calls and denied requests never reach the provider',async()=>{
  let admissionCalls=0,providerCalls=0;
  const classifier=createSemanticClassifier({enabled:true,apiKey:'test-only',mode:'llm',localEnabled:false,
    admit:async({actorId})=>{admissionCalls++;return actorId==='allowed';},
    provider:async()=>{providerCalls++;return output;}});
  const denied=await classifier.prepare({...input,title:'Другая идея'}, {actorId:'denied'});
  assert.equal(denied.reason,'CLASSIFIER_BUDGET_LIMIT');assert.equal(providerCalls,0);
  assert.equal((await classifier.prepare(input,{actorId:'allowed'})).status,'READY');
  assert.equal((await classifier.prepare(input,{actorId:'allowed'})).status,'READY');
  assert.equal(admissionCalls,2);assert.equal(providerCalls,1);
});

it('one actor budget denial cannot poison a later eligible actor with identical text',async()=>{
  let calls=0;
  const classifier=createSemanticClassifier({enabled:true,apiKey:'test-only',mode:'llm',
    admit:async({actorId})=>actorId==='eligible',provider:async()=>{calls++;return output;}});
  assert.equal((await classifier.prepare(input,{actorId:'exhausted'})).reason,'CLASSIFIER_BUDGET_LIMIT');
  assert.equal((await classifier.prepare(input,{actorId:'eligible'})).status,'READY');assert.equal(calls,1);
});

it('the overall deadline includes shared admission and cannot start a paid request after expiry',async()=>{
  let calls=0;
  const classifier=createSemanticClassifier({enabled:true,apiKey:'test-only',mode:'llm',totalDeadlineMs:20,
    admit:()=>new Promise(()=>{}),provider:async()=>{calls++;return output;}});
  const start=Date.now();assert.equal((await classifier.prepare(input,{actorId:'test'})).status,'FALLBACK');
  assert.ok(Date.now()-start<500);assert.equal(calls,0);
});
