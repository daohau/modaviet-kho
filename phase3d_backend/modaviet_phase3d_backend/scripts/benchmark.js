const base=process.env.BENCHMARK_URL||'http://localhost:8080'; const token=process.env.BENCHMARK_TOKEN||''; const n=Number(process.env.BENCHMARK_REQUESTS||50);
function pct(a,p){const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(s.length*p)-1)];}
async function run(){const arr=[];for(let i=0;i<n;i++){const t=performance.now();const r=await fetch(base+'/healthz',{headers:token?{Authorization:'Bearer '+token}:{}});await r.text();arr.push(performance.now()-t);} console.log(JSON.stringify({n,p50_ms:Math.round(pct(arr,.5)),p95_ms:Math.round(pct(arr,.95)),p99_ms:Math.round(pct(arr,.99)),max_ms:Math.round(Math.max(...arr))},null,2));}
run().catch(e=>{console.error(e);process.exit(1)});
