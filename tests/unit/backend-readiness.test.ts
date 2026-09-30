import { describe, it, expect } from 'vitest';
// Node runtime helper is intentionally plain ESM.
import { waitForReady } from '../../scripts/readiness.mjs';

describe('release readiness deadline', () => {
  it('aborts an indefinitely pending fetch and reaches its bounded deadline', async () => {
    const original=globalThis.fetch;
    let aborted=false;
    globalThis.fetch=(_url,options)=>new Promise((_resolve,reject)=>{
      options?.signal?.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));});
    });
    try {
      await expect(waitForReady('http://127.0.0.1/ready',{timeoutMs:30,requestTimeoutMs:30})).rejects.toThrow('did not become ready');
      expect(aborted).toBe(true);
    } finally {globalThis.fetch=original;}
  });
});
