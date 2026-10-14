// QA-only external plugin. No product imports, harness mocks or budget rewrites.
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const root = process.env.BUDGET_PROOF_ROOT;
if (!root) throw new Error('Missing isolated proof root');
const phase = process.env.BUDGET_PROOF_PHASE;
const trace = (event, params = {}, extra = {}) => {
  fs.appendFileSync(path.join(root, 'lifecycle.jsonl'), JSON.stringify({
    event, phase, sessionId: params.sessionId, sessionKey: params.sessionKey,
    advancementKey: params.advancementKey, tokenBudget: params.tokenBudget,
    runtimeSettings: params.runtimeSettings, runtimeContext: params.runtimeContext && {
      provider: params.runtimeContext.provider, modelId: params.runtimeContext.modelId,
      modelContextWindow: params.runtimeContext.modelContextWindow,
      tokenBudget: params.runtimeContext.tokenBudget,
    }, ...extra,
  }) + '\n');
};
let worker;
let sequence = 0;
const pending = new Map();
function store(key) {
  if (!worker) {
    worker = new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      const {DatabaseSync}=require('node:sqlite');
      const db=new DatabaseSync(workerData);
      db.exec('CREATE TABLE IF NOT EXISTS commits (key TEXT PRIMARY KEY)');
      parentPort.on('message',({id,key})=>{
        try { const r=db.prepare('INSERT OR IGNORE INTO commits VALUES (?)').run(key);
          parentPort.postMessage({id,status:r.changes?'committed':'duplicate'});
        } catch(e) { parentPort.postMessage({id,error:e.message}); }
      });
    `, { eval: true, workerData: path.join(root, 'probe.sqlite') });
    worker.on('message', ({id, status, error}) => {
      const promise = pending.get(id); pending.delete(id);
      if (error) promise.reject(new Error(error)); else promise.resolve(status);
    });
    worker.on('error', error => { for (const p of pending.values()) p.reject(error); pending.clear(); });
    worker.unref();
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, {resolve, reject}); worker.postMessage({id, key});
  });
}
export default {
  id: 'budget-proof', kind: 'context-engine',
  register(api) {
    api.registerContextEngine('budget-proof', () => ({
      info: { id: 'budget-proof', name: 'Isolated budget boundary probe', ownsCompaction: true,
        turnMaintenanceMode: 'foreground', transcriptSemantics: {
          currentTurnFence: 'before-current-turn-entry-v1', turnAdvancementIdempotency: 'atomic-idempotent-v1',
        } },
      async bootstrap(params) { trace('bootstrap', params); return {bootstrapped: true}; },
      async ingest() { return {ingested: true}; },
      async assemble(params) {
        trace('assemble', params, {messageCount: params.messages.length});
        return {messages: params.messages, estimatedTokens: 0};
      },
      async compact() { return {ok: true, compacted: false}; },
      async commitTurn(params) {
        trace('commit-attempt', params, {messageCount: params.messages.length});
        if (fs.existsSync(path.join(root, 'hold-commits'))) throw new Error('QA fixture holds commit before effect');
        const status = await store(params.advancementKey);
        trace('commit-result', params, {status});
        if (fs.existsSync(path.join(root, 'hold-after-effect'))) throw new Error('QA fixture holds acknowledgment after idempotent effect');
        return {status};
      },
      async maintain(params) {
        trace('maintain', params); return {changed: false, bytesFreed: 0, rewrittenEntries: 0};
      },
      async dispose() { if (worker) { await worker.terminate(); worker = undefined; } },
    }));
  },
};
