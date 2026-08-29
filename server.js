const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.MANSA_API_KEY;
const BASE = 'https://www.mansaapi.com';
const SNAPSHOT_FILE = path.join(__dirname,'data','snapshots.json');
const mem = new Map();

function cacheGet(k, ttl){ const x=mem.get(k); if(!x || Date.now()-x.t>ttl) return null; return x.v; }
function cacheSet(k,v){ mem.set(k,{t:Date.now(),v}); return v; }
async function mansa(p){
  if(!API_KEY) throw Object.assign(new Error('MANSA_API_KEY missing'),{status:500});
  const r = await fetch(BASE+p,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'}});
  const text = await r.text(); let body; try{body=JSON.parse(text)}catch{body={raw:text}};
  if(!r.ok){ const e=new Error(`Mansa API ${r.status}`); e.status=r.status; e.body=body; throw e; }
  return body;
}
function arrOf(x){ if(Array.isArray(x)) return x; return x?.stocks||x?.data||x?.results||x?.history||x?.prices||[]; }
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function getClose(x){ return num(x.close ?? x.price ?? x.last_price ?? x.current_price); }
function getDate(x){ return x.date || x.trading_date || x.timestamp || x.updated_at || new Date().toISOString(); }
function saveSnapshots(stocks){
  try{
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE),{recursive:true});
    let db={}; try{db=JSON.parse(fs.readFileSync(SNAPSHOT_FILE,'utf8'))}catch{}
    const day=new Date().toISOString().slice(0,10);
    for(const s of stocks){ const sym=s.ticker||s.symbol||s.code||s.canonical_symbol; const c=getClose(s); if(!sym||c==null) continue; db[sym]=db[sym]||[]; const rec={date:day,close:c,high:num(s.high??s.day_high),low:num(s.low??s.day_low),volume:num(s.volume)}; const i=db[sym].findIndex(x=>x.date===day); if(i>=0) db[sym][i]=rec; else db[sym].push(rec); db[sym]=db[sym].slice(-400); }
    fs.writeFileSync(SNAPSHOT_FILE,JSON.stringify(db,null,2));
  }catch(e){ console.warn('Snapshot write skipped:',e.message); }
}
function localHistory(sym){ try{ const db=JSON.parse(fs.readFileSync(SNAPSHOT_FILE,'utf8')); return db[sym]||[]; }catch{return []} }
function ema(values,p){ if(values.length<p) return []; const k=2/(p+1); let e=values.slice(0,p).reduce((a,b)=>a+b,0)/p; const out=Array(p-1).fill(null).concat([e]); for(let i=p;i<values.length;i++){ e=values[i]*k+e*(1-k); out.push(e); } return out; }
function sma(values,p){ return values.map((_,i)=> i+1<p?null:values.slice(i-p+1,i+1).reduce((a,b)=>a+b,0)/p); }
function rsi(values,p=14){ if(values.length<=p) return null; let gains=0,losses=0; for(let i=1;i<=p;i++){const d=values[i]-values[i-1]; if(d>=0)gains+=d; else losses-=d;} let ag=gains/p, al=losses/p; for(let i=p+1;i<values.length;i++){const d=values[i]-values[i-1]; ag=(ag*(p-1)+Math.max(d,0))/p; al=(al*(p-1)+Math.max(-d,0))/p;} if(al===0) return 100; const rs=ag/al; return 100-(100/(1+rs)); }
function macd(values){ if(values.length<35) return null; const e12=ema(values,12), e26=ema(values,26); const line=values.map((_,i)=>e12[i]!=null&&e26[i]!=null?e12[i]-e26[i]:null); const clean=line.filter(v=>v!=null); const sig=ema(clean,9); const ml=clean.at(-1), sl=sig.at(-1); if(ml==null||sl==null) return null; return {macd:ml,signal:sl,histogram:ml-sl}; }
function atr(rows,p=14){ if(rows.length<p+1) return null; const tr=[]; for(let i=1;i<rows.length;i++){const h=num(rows[i].high),l=num(rows[i].low),pc=getClose(rows[i-1]); if(h==null||l==null||pc==null) continue; tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));} if(tr.length<p) return null; return tr.slice(-p).reduce((a,b)=>a+b,0)/p; }
function technical(rows){
  const sorted=[...rows].sort((a,b)=>String(getDate(a)).localeCompare(String(getDate(b))));
  const closes=sorted.map(getClose).filter(v=>v!=null); if(!closes.length) return null;
  const s20=sma(closes,20).at(-1), s50=sma(closes,50).at(-1), e20=ema(closes,20).at(-1);
  const rr=rsi(closes,14), mm=macd(closes), aa=atr(sorted,14), last=closes.at(-1);
  const recent=sorted.slice(-20), highs=recent.map(x=>num(x.high)).filter(v=>v!=null), lows=recent.map(x=>num(x.low)).filter(v=>v!=null);
  const resistance=highs.length?Math.max(...highs):null, support=lows.length?Math.min(...lows):null;
  let score=0; if(rr!=null){if(rr>=50&&rr<70)score++; if(rr<40)score--; if(rr>=70)score--;} if(mm){score+=mm.histogram>0?1:-1;} if(s20!=null)score+=last>s20?1:-1; if(s50!=null)score+=last>s50?1:-1;
  const trend=score>=3?'إيجابي':score<=-2?'سلبي':'محايد / بحذر';
  return {rsi:rr,macd:mm,sma20:s20,sma50:s50,ema20:e20,atr14:aa,support20:support,resistance20:resistance,trend,score,last,points:sorted};
}

app.get('/api/egx/stocks', async(req,res)=>{
  try{ let data=cacheGet('stocks',25*60*1000); if(!data){data=await mansa('/api/v1/markets/exchanges/EGX/stocks');cacheSet('stocks',data); saveSnapshots(arrOf(data));} res.json(data); }
  catch(e){res.status(e.status||500).json({error:e.message,details:e.body||null});}
});
app.get('/api/egx/stocks/:ticker', async(req,res)=>{
  try{ const t=encodeURIComponent(req.params.ticker); let data=cacheGet('q:'+t,10*60*1000); if(!data){data=await mansa('/api/v1/markets/exchanges/EGX/stocks/'+t);cacheSet('q:'+t,data);} res.json(data); }
  catch(e){res.status(e.status||500).json({error:e.message,details:e.body||null});}
});
app.get('/api/egx/stocks/:ticker/history', async(req,res)=>{
  const t=encodeURIComponent(req.params.ticker), range=encodeURIComponent(req.query.range||'6M'), limit=encodeURIComponent(req.query.limit||'250');
  try{ const data=await mansa(`/api/v1/markets/exchanges/EGX/stocks/${t}/history?range=${range}&limit=${limit}&order=asc`); res.json({source:'mansa',...data}); }
  catch(e){ const local=localHistory(req.params.ticker); res.status(200).json({source:'local_snapshots',history:local,history_entitlement:false,mansa_status:e.status||null,message:'Mansa historical OHLCV is not available on the current tier. Moody Trader will accumulate daily snapshots automatically.',details:e.body||null}); }
});
app.get('/api/egx/stocks/:ticker/analysis', async(req,res)=>{
  const sym=req.params.ticker, t=encodeURIComponent(sym); let quote=null, rows=[], source='mansa_history'; let historyEntitlement=true;
  try{ quote=await mansa('/api/v1/markets/exchanges/EGX/stocks/'+t); }catch(e){ return res.status(e.status||500).json({error:'quote_failed',details:e.body||e.message}); }
  try{ const h=await mansa(`/api/v1/markets/exchanges/EGX/stocks/${t}/history?range=1Y&limit=260&order=asc`); rows=arrOf(h); }
  catch(e){ historyEntitlement=false; source='local_snapshots'; rows=localHistory(sym); }
  const tech=technical(rows);
  res.json({symbol:sym,quote,source,history_entitlement:historyEntitlement,history_count:rows.length,technical:tech,history:rows.slice(-120)});
});

app.get('/api/health',(req,res)=>res.json({ok:true,service:'moody-trader'}));

app.use(express.static(path.join(__dirname,'public')));
app.listen(PORT,()=>console.log(`Moody Trader v0.4: http://localhost:${PORT}`));
