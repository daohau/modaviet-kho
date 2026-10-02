const base=process.env.API_URL||'http://localhost:8080';
const authToken=process.env.AUTH_TOKEN||''; const headers={'content-type':'application/json','x-user-email':'tungnm@modaviet.vn',...(authToken?{authorization:'Bearer '+authToken}:{})};
async function call(method,path,body,expectOk=true){const t=performance.now();const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});const j=await r.json();const ms=performance.now()-t;if(expectOk&&!r.ok)throw new Error(`${path} ${r.status}: ${JSON.stringify(j)}`);if(!expectOk&&r.ok)throw new Error(`${path} expected BLOCK but passed`);return{r,j,ms};}
function rec(id,ref,del,acc,reason='',quality='ACCEPTED'){return{clientRequestId:id,receiptDate:'2026-09-16',supplierId:'110733698',deliveredBy:'REGRESSION',lines:[{prRefKey:ref,deliveredQty:del,acceptedQty:acc,actualUnitPrice:7000,qualityStatus:quality,overReceiptReason:reason}]};}
const times=[];
// TC02 + TC03
for(const x of [
 ['REG-TC02','UAT-PR-AP01',10,10,'','ACCEPTED'],
 ['REG-TC03A','UAT-PR-AP02',10,10,'','ACCEPTED'],
 ['REG-TC03B','UAT-PR-AP01',10,8,'','PARTIAL_REJECT']]){const z=await call('POST','/v1/receipts',rec(...x));times.push(z.ms);}
await call('POST','/v1/receipts',rec('REG-TC03C','UAT-PR-AP02',30,30),false);
const d=await call('POST','/v1/receipts',rec('REG-TC03D','UAT-PR-AP02',30,30,'NCC giao vượt 1,62; regression')); times.push(d.ms);
if(d.j.receiptCode!=='PN260916-004')throw new Error('Validation BLOCK consumed receipt code: '+d.j.receiptCode);
// TC04
const issue=await call('POST','/v1/issues',{clientRequestId:'REG-TC04',issueDate:'2026-09-16',executionCode:'s146926',receiver:'REGRESSION',lines:[{reservationId:'UAT-RES-AP01',issueQty:100}]});times.push(issue.ms);
// TC05
await call('POST','/v1/issues',{clientRequestId:'REG-TC05A',issueDate:'2026-09-16',executionCode:'S146926',receiver:'REGRESSION',lines:[{reservationId:'UAT-RES-AP02',issueQty:203}]},false);
await call('POST','/v1/issues',{clientRequestId:'REG-TC05B',issueDate:'2026-09-16',executionCode:'S146926',receiver:'REGRESSION',lines:[{reservationId:'UAT-RES-AP02',issueQty:256}]},false);
// TC06
const ret=await call('POST','/v1/returns',{clientRequestId:'REG-TC06A',returnDate:'2026-09-16',sourceIssueLineId:issue.j.lines[0].issueLineId,returnQty:4,usableQty:4,scrapQty:0,returnedBy:'REGRESSION'});times.push(ret.ms);
await call('POST','/v1/returns',{clientRequestId:'REG-TC06B',returnDate:'2026-09-16',sourceIssueLineId:issue.j.lines[0].issueLineId,returnQty:97,usableQty:97,scrapQty:0,returnedBy:'REGRESSION'},false);
// TC07 same client_request_id twice
const payload={clientRequestId:'REG-TC07',returnDate:'2026-09-16',sourceIssueLineId:issue.j.lines[0].issueLineId,returnQty:1,usableQty:1,scrapQty:0,returnedBy:'REGRESSION'};
const r1=await call('POST','/v1/returns',payload);const r2=await call('POST','/v1/returns',payload);times.push(r1.ms,r2.ms);if(r1.j.returnId!==r2.j.returnId)throw new Error('Idempotency failed');
// TC08 reconcile
const stock=await call('GET','/v1/stock/1BO-POLY06');if(Number(stock.j.physical_qty)!==260||Number(stock.j.reserved_qty)!==255||Number(stock.j.available_qty)!==5)throw new Error('Stock reconcile failed '+JSON.stringify(stock.j));
const p95=[...times].sort((a,b)=>a-b)[Math.ceil(times.length*.95)-1];
console.log(JSON.stringify({ok:true,tc:'TC01-TC08 core regression',transaction_samples:times.length,p95_ms:Math.round(p95),times_ms:times.map(x=>Math.round(x))},null,2));
