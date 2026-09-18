import { randomUUID } from 'node:crypto';
const id = () => randomUUID();
const now = () => new Date().toISOString();
const check = (ok, message) => { if (!ok) throw new Error(message); };
export const securities = [{symbol:'MSFT',name:'Microsoft',price:41000},{symbol:'AAPL',name:'Apple',price:22500},{symbol:'NVDA',name:'NVIDIA',price:12500},{symbol:'VTI',name:'Total US Market ETF',price:28000}];
export function seed() { return {date:now().slice(0,10),orders:[],trades:[],ledger:[{id:id(),type:'DEPOSIT',cash:10000000,symbol:null,quantity:0,at:now()}],events:[],exceptions:[],snapshots:[]}; }
export function portfolio(s) {
 let cash=0, realized=0; const holdings={};
 for(const e of s.ledger) { cash+=e.cash; if(!e.symbol) continue; const p=holdings[e.symbol]??={symbol:e.symbol,quantity:0,cost:0};
 if(e.quantity>0){p.quantity+=e.quantity;p.cost+=-e.cash;}
 else { const cost=p.cost/p.quantity*-e.quantity; realized+=e.cash-cost;p.cost-=cost;p.quantity+=e.quantity; }
 }
 const positions=Object.values(holdings).filter(p=>p.quantity>0).map(p=>({...p,averageCost:Math.round(p.cost/p.quantity),price:securities.find(x=>x.symbol===p.symbol).price,marketValue:p.quantity*securities.find(x=>x.symbol===p.symbol).price}));
 const value=cash+positions.reduce((n,p)=>n+p.marketValue,0);return {cash,positions,value,realized,unrealized:positions.reduce((n,p)=>n+p.marketValue-p.cost,0),returnPct:(value/10000000-1)*100};
}
function event(s,type,entity,actor,detail={}) {s.events.push({id:id(),type,entity,actor,at:now(),...detail});}
function snapshot(s){s.snapshots.push({id:id(),date:s.date,at:now(),...portfolio(s)});event(s,'ClientReportUpdated',s.snapshots.at(-1).id,'system');}
export function command(s, action, data, actor) {
 const role=actor; const requireRole=(r)=>check(role===r,`Requires ${r} persona`);
 if(action==='create') { requireRole('investment');check(securities.some(x=>x.symbol===data.symbol),'Unknown security');check(['BUY','SELL'].includes(data.side),'Invalid side');check(Number.isSafeInteger(data.quantity)&&data.quantity>0&&data.quantity<=100000,'Quantity must be a positive integer, maximum 100000');check(['MARKET','LIMIT'].includes(data.orderType),'Invalid order type');check(data.orderType!=='LIMIT'||(Number.isSafeInteger(data.limitPrice)&&data.limitPrice>0),'Limit price must be positive cents'); const o={id:id(),symbol:data.symbol,side:data.side,quantity:data.quantity,orderType:data.orderType,limitPrice:data.orderType==='LIMIT'?data.limitPrice:null,status:'PENDING',filled:0,createdAt:now()}; s.orders.push(o);event(s,'OrderCreated',o.id,actor);return o; }
 if(['approve','execute'].includes(action)) {requireRole('investment');const o=s.orders.find(x=>x.id===data.id);check(o,'Order not found');
 if(action==='approve'){check(o.status==='PENDING','Order must be pending');o.status='APPROVED';event(s,'OrderApproved',o.id,actor);return o;}
 check(['APPROVED','PARTIALLY_FILLED','SUBMITTED'].includes(o.status),'Order cannot execute');const price=securities.find(x=>x.symbol===o.symbol).price;check(o.orderType!=='LIMIT'||(o.side==='BUY'?price<=o.limitPrice:price>=o.limitPrice),'Limit not reached');const quantity=data.quantity??o.quantity-o.filled;check(Number.isSafeInteger(quantity)&&quantity>0&&quantity<=o.quantity-o.filled,'Invalid fill quantity');
 if(o.status==='APPROVED'){o.status='SUBMITTED';event(s,'OrderSubmitted',o.id,actor);}
 const due=new Date(s.date+'T12:00:00Z'); do{due.setUTCDate(due.getUTCDate()+1);}while([0,6].includes(due.getUTCDay()));
 const t={id:id(),orderId:o.id,symbol:o.symbol,side:o.side,quantity,price,fee:500,status:'PENDING',tradeDate:s.date,due:due.toISOString().slice(0,10),executedAt:now(),broker:'Simulated broker'};s.trades.push(t);o.filled+=quantity;o.status=o.filled===o.quantity?'FILLED':'PARTIALLY_FILLED';event(s,'TradeExecuted',t.id,actor,{orderId:o.id});return t; }
 requireRole('operations');
 if(action==='advance'){const d=new Date(s.date+'T12:00:00Z');do{d.setUTCDate(d.getUTCDate()+1);}while([0,6].includes(d.getUTCDay()));s.date=d.toISOString().slice(0,10);event(s,'BusinessDateAdvanced',s.date,actor);return;}
 if(action==='settle'){const t=s.trades.find(x=>x.id===data.id);check(t,'Trade not found');check(['PENDING','FAILED'].includes(t.status),'Already settled');check(t.due<=s.date,'Settlement is not due yet');const p=portfolio(s);const amount=t.quantity*t.price;const held=p.positions.find(x=>x.symbol===t.symbol)?.quantity??0;
 const reason=t.side==='BUY'&&p.cash<amount+t.fee?'Insufficient cash':t.side==='SELL'&&held<t.quantity?'Insufficient settled holdings':null;
 if(reason){t.status='FAILED';t.reason=reason;event(s,'SettlementFailed',t.id,actor,{reason});return t;}
 t.status='SETTLED';delete t.reason;t.settledAt=now();s.ledger.push({id:id(),tradeId:t.id,type:t.side,symbol:t.symbol,quantity:t.side==='BUY'?t.quantity:-t.quantity,cash:t.side==='BUY'?-amount:amount,at:now()},{id:id(),tradeId:t.id,type:'FEE',symbol:null,quantity:0,cash:-t.fee,at:now()});event(s,'SettlementCompleted',t.id,actor);event(s,'LedgerUpdated',t.id,'system');event(s,'PositionUpdated',t.symbol,'system');snapshot(s);return t;}
 if(action==='reconcile'){check(securities.some(x=>x.symbol===data.symbol),'Unknown security');check(Number.isSafeInteger(data.actual)&&data.actual>=0,'Broker quantity must be a nonnegative integer');const expected=portfolio(s).positions.find(x=>x.symbol===data.symbol)?.quantity??0;const e={id:id(),symbol:data.symbol,expected,actual:data.actual,difference:expected-data.actual,status:expected===data.actual?'MATCHED':'OPEN',at:now()};s.exceptions.push(e);event(s,'ReconciliationCompleted',e.id,actor);return e;}
 if(action==='resolve'){const e=s.exceptions.find(x=>x.id===data.id);check(e&&e.status==='OPEN','Open exception not found');check(typeof data.note==='string'&&data.note.trim().length>=5,'Resolution note requires at least 5 characters');e.status='RESOLVED';e.note=data.note.trim();event(s,'ReconciliationResolved',e.id,actor,{note:e.note});return e;}
 throw new Error('Unknown action');
}
