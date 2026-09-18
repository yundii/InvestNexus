import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed, command } from '../src/platform.js';
import { portfolio } from '../src/ledger.js';
import { MockMarketDataProvider, parseAlphaHistory, cents } from '../src/market-provider.js';
import { performancePoint } from '../src/performance.js';
import { reconcileBook, certifiedReconciliation } from '../src/reconciliation.js';
function held() {
 const s=seed(); const o=command(s,'create',{symbol:'MSFT',side:'BUY',quantity:100,orderType:'MARKET'},'investment') as any;
 command(s,'approve',{id:o.id},'investment'); const t=command(s,'execute',{id:o.id},'investment') as any;
 command(s,'advance',{},'operations');command(s,'settle',{id:t.id},'operations');s.ledgerVersion=3;return s;
}
test('market marks change P&L without modifying ledger; missing marks preserve positions and cash',()=>{
 const s=held(), ledger=structuredClone(s.ledger); s.prices={MSFT:42000};
 const p=portfolio(s); assert.equal(p.value,10099500);assert.equal(p.unrealized,100000);assert.deepEqual(s.ledger,ledger);
 s.prices={};const missing=portfolio(s);assert.equal(missing.value,null);assert.equal(missing.unrealized,null);assert.equal(missing.positions[0].quantity,100);assert.equal(missing.cash,p.cash);assert.equal(missing.valuationStatus,'INCOMPLETE');
});
test('mock history is repeatable, dated and never uses future or weekend quotes',async()=>{
 const provider=new MockMarketDataProvider('2026-09-18');const points=await provider.getHistory('MSFT','2026-09-21');
 assert.deepEqual(points,await provider.getHistory('MSFT','2026-09-21'));assert.equal(points.at(-1)!.price,41360);
 assert.equal(points.length,60);assert.ok(points.every(p=>p.date<='2026-09-21' && ![0,6].includes(new Date(p.date).getUTCDay())));
});
test('Alpha parser validates symbols, quotas and exact decimal prices, excludes future quotes',()=>{
 assert.equal(cents('410.005'),41001);assert.throws(()=>cents('NaN'));assert.throws(()=>cents('9007199254740992'));
 const payload={'Meta Data':{'2. Symbol':'MSFT'},'Time Series (Daily)':{'2026-09-18':{'4. close':'410.005'},'2026-09-21':{'4. close':'999.00'}}};
 assert.deepEqual(parseAlphaHistory('MSFT',payload,'2026-09-18'),[{symbol:'MSFT',date:'2026-09-18',price:41001}]);
 assert.throws(()=>parseAlphaHistory('AAPL',payload,'2026-09-18'),/symbol/);assert.throws(()=>parseAlphaHistory('MSFT',{Note:'quota'},'2026-09-18'),/quota/);
});
test('full reconciliation includes cash, omitted holdings and unexpected broker positions; certification expires after ledger changes',()=>{
 const s=held();reconcileBook(s,{asOf:s.date,cash:5899000,positions:[{symbol:'AAPL',quantity:1}],broker:'Broker'});
 assert.equal(s.exceptions.find(e=>e.symbol==='MSFT')!.difference,100);assert.equal(s.exceptions.find(e=>e.symbol==='AAPL')!.difference,-1);
 assert.throws(()=>certifiedReconciliation(s),/open/);
 for(const e of s.exceptions.filter(e=>e.status==='OPEN'))command(s,'resolve',{id:e.id,note:'Statement mismatch acknowledged'},'operations');
 assert.equal(certifiedReconciliation(s).status,'RESOLVED_WITH_EXCEPTIONS');s.ledgerVersion!++;assert.throws(()=>certifiedReconciliation(s),/Reconcile/);
});
test('performance compares normalized price returns; skipped business dates do not claim daily returns',()=>{
 const first=performancePoint('2026-09-18',10000000,10000000,28000,28000);
 const next=performancePoint('2026-09-21',10100000,10000000,28560,28000,first);
 assert.ok(Math.abs(next.dailyReturnPct!-1)<1e-9);assert.ok(Math.abs(next.benchmarkReturnPct-2)<1e-9);assert.ok(Math.abs(next.excessReturnPct+1)<1e-9);
 assert.equal(performancePoint('2026-09-23',10200000,10000000,28560,28000,next).dailyReturnPct,null);
});
