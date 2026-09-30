// Explicit, bounded paid synthetic evaluation. Key stays in local env memory.
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createSemanticClassifier } from '../src/server/routing/semantic.mjs';
import { routePrepared } from '../src/server/routing/adapter.mjs';
import { loadRoutingDataset,syntheticRoutingCatalog,evaluatePredictions } from './evaluate-routing.mjs';
import * as engine from '../dist/routing/rules-v2.mjs';

const config=parseEnv(readFileSync('.env.sevens','utf8'));
const args=process.argv.slice(2);
if(args.some((arg)=>arg!=='--live'))throw new Error('Only --live is supported');
const allowPaidCalls=args.includes('--live');
if(allowPaidCalls&&!config.OPENAI_API_KEY)throw new Error('Configured server API key required');
const data=loadRoutingDataset('fixtures/routing-v2-validation.json');
if(data.syntheticOnly!==true||data.cases.length>100)throw new Error('Only bounded synthetic evaluation is supported');
const model=process.env.OPENAI_CLASSIFIER_MODEL||'gpt-6-sol';
const classifier=createSemanticClassifier({enabled:true,apiKey:config.OPENAI_API_KEY,model,mode:'llm',localEnabled:false,deadlineMs:15000,totalDeadlineMs:15000,maxCallsPerHour:100});
const catalog=syntheticRoutingCatalog(),predictions=[],preparedResults=[];
const cacheFile='.data/classifier-verification/model-semantic-cache.json';
const previousReportFile='.data/classifier-verification/model-report.json';
let originalLiveLatency;
if(existsSync('.data/classifier-verification/live-eval.log')) {
  const row=readFileSync('.data/classifier-verification/live-eval.log','utf8').split('\n').findLast((line)=>line.startsWith('{"model"'));
  if(row)originalLiveLatency=JSON.parse(row).latencyMs;
}
if(!originalLiveLatency&&existsSync(previousReportFile))originalLiveLatency=JSON.parse(readFileSync(previousReportFile,'utf8')).liveLatencyMs;
mkdirSync('.data/classifier-verification',{recursive:true});
const saved=existsSync(cacheFile)?JSON.parse(readFileSync(cacheFile,'utf8')):{model,prepared:[]};
const savedMap=new Map(saved.model===model?saved.prepared.map((item)=>[item.id,item.prepared]):[]);
if(!allowPaidCalls&&data.cases.some((item)=>!savedMap.has(item.id))) {
  throw new Error('Cached evaluation is incomplete; pass --live explicitly to allow bounded paid calls');
}
const statuses={READY:0,FALLBACK:0},latencies=[];let paidCalls=0;
for(let index=0;index<data.cases.length;index+=2){
  const values=await Promise.all(data.cases.slice(index,index+2).map(async(item)=>{
    const start=performance.now();if(!savedMap.has(item.id))paidCalls++;
    const prepared=savedMap.get(item.id)??await classifier.prepare(item.input);
    preparedResults.push({id:item.id,prepared});
    latencies.push(Math.round(performance.now()-start));statuses[prepared.status]++;
    const decision=routePrepared(engine,item.input,catalog,prepared);
    const {analysis,...publicDecision}=decision;
    return {id:item.id,decision:publicDecision};
  }));
  predictions.push(...values);
  writeFileSync(cacheFile,JSON.stringify({model,prepared:preparedResults},null,2)+'\n');
  writeFileSync('.data/classifier-verification/model-predictions.json',JSON.stringify({model,predictions},null,2)+'\n');
  if(predictions.length%10===0)console.log(JSON.stringify({completed:predictions.length,total:data.cases.length,...statuses}));
  if(index+2<data.cases.length)await new Promise((resolve)=>setTimeout(resolve,250));
}
const result=evaluatePredictions(data.cases,catalog,predictions);
latencies.sort((a,b)=>a-b);
const report={...result,model,datasetVersion:data.datasetVersion,statuses,
  paidCallsInThisRun:paidCalls,liveLatencyMs:originalLiveLatency,
  latencyMs:{p50:latencies[Math.floor(latencies.length*.5)],p95:latencies[Math.ceil(latencies.length*.95)-1]},
  scope:'Synthetic pre-labelled validation set; not field accuracy or a zero-error guarantee'};
mkdirSync('.data/classifier-verification',{recursive:true});
writeFileSync('.data/classifier-verification/model-predictions.json',JSON.stringify({model,predictions},null,2)+'\n');
writeFileSync('.data/classifier-verification/model-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({model,statuses,overall:report.overall,byLanguage:report.byLanguage,paidCallsInThisRun:paidCalls,liveLatencyMs:originalLiveLatency}));
