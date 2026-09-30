// HTTP measurements on a fresh synthetic schema; never reads DATABASE_URL.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { disposableDatabase, TEST_PASSWORD } from '../tests/integration/postgres/helpers/disposable-db.mjs';
import { createServer } from '../src/server/http/app.mjs';

if(!process.env.BACKEND_PG_TEST_URL){
  process.env.BACKEND_PG_TEST_URL=parseEnv(readFileSync('.data/backend-verification/connection.env','utf8')).BACKEND_PG_TEST_URL;
}
const stand=await disposableDatabase();
let server;
try {
  const user=(await stand.db.query("SELECT * FROM users WHERE email_normalized='citizen1@example.test'")).rows[0];
  const org=(await stand.db.query("SELECT id FROM organizations WHERE code='DEMO_TRANSPORT'")).rows[0];
  const territory=(await stand.db.query("SELECT id FROM territories WHERE code='DEMO_SEMEY'")).rows[0];
  const records=await stand.db.query(`INSERT INTO ideas(region_id,author_id,title,problem,solution,
    requested_category_code,effective_category_code,territory_id,status,organization_id,public_number,submitted_at)
    SELECT $1,$2,'Умные светофоры — нагрузочный пример '||n,
      'Синтетическая проблема транспорта и безопасности дороги для измерения скорости.',
      'Синтетическое предложение установить умные светофоры и датчики на дороге.',
      NULL,'TRANSPORT',$3,'RECEIVED',$4,'ABAI-BENCH-'||n,now()
    FROM generate_series(1,1000) n RETURNING id,version`,[user.region_id,user.id,territory.id,org.id]);
  server=createServer(stand.db,{origin:'http://localhost:3000',secureCookies:false,uploadDir:stand.uploadDir});
  await new Promise((r)=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const sessions=[];
  for(let n=0;n<20;n++){
    const response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},
      body:JSON.stringify({email:'transport@example.test',password:TEST_PASSWORD})});
    if(!response.ok)throw new Error('Benchmark synthetic login failed');
    sessions.push({cookie:response.headers.get('set-cookie').split(';')[0],csrf:(await response.json()).data.csrfToken});
  }
  const reads=[],writes=[];
  const work=async(session,index,method,count)=>{
    for(let n=0;n<count;n++){
      const read=method==='GET';
      const endpoint=read?'/api/v1/ideas?scope=staff&pageSize=20':`/api/v1/ideas/${records.rows[index*count+n].id}/comments`;
      const started=performance.now();
      const response=await fetch(base+endpoint,{method,headers:{cookie:session.cookie,origin:'http://localhost:3000',
        ...(read?{}:{'content-type':'application/json','x-csrf-token':session.csrf,'idempotency-key':randomUUID()})},
        ...(read?{}:{body:JSON.stringify({expectedVersion:1,visibility:'INTERNAL',body:'Синтетическая запись для измерения скорости.'})})});
      await response.arrayBuffer();
      if(!response.ok)throw new Error(`Benchmark HTTP ${response.status}`);
      (read?reads:writes).push(performance.now()-started);
    }
  };
  await Promise.all(sessions.map((session,index)=>work(session,index,'GET',20)));
  await Promise.all(sessions.map((session,index)=>work(session,index,'POST',5)));
  const p95=(values)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*0.95)-1];
  const report={date:new Date().toISOString(),database:'PostgreSQL',syntheticIdeas:1000,concurrency:20,
    host:{platform:os.platform(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,ramGiB:Math.round(os.totalmem()/1024**3)},
    reads:{requests:reads.length,p95Ms:Math.round(p95(reads)),targetMs:800},
    writes:{requests:writes.length,p95Ms:Math.round(p95(writes)),targetMs:1500},
    scope:'Local HTTP Node API + PostgreSQL; excludes Next proxy, Docker API runtime, files and LLM'};
  report.targetsMet=report.reads.p95Ms<800&&report.writes.p95Ms<1500;
  mkdirSync('.data/backend-verification',{recursive:true});
  writeFileSync('.data/backend-verification/benchmark-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  if(server)await new Promise((r)=>server.close(r));
  await stand.close();
}
