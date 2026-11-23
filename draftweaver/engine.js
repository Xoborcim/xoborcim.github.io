import { ROLES } from './catalog.js';
export const QUEUES = {solo:420,flex:440,clash:700};
export function patchOf(version) { return String(version).split('.').slice(0,2).join('.'); }
const pct = (w,n) => n ? 100*w/n : 50;
const shrink = (w,n,prior=50,weight=80) => (100*w+prior*weight)/(n+weight);
const pairBaseline = (a,b) => Math.max(20,Math.min(80,a+b-50));
const record = (map,key,win) => {const v=map.get(key)||{games:0,wins:0}; v.games++; v.wins+=Number(win); map.set(key,v);};
export function validateDataset(input) {
 if (!input || input.schemaVersion!==1 || !Array.isArray(input.matches) || !input.matches.length) throw Error('Expected a Draftweaver dataset with schemaVersion: 1 and a nonempty matches array.');
 if (input.matches.length>50000) throw Error('Import at most 50,000 matches per file.');
 if (!input.meta || typeof input.meta.source!=='string' || !['demo','riot'].includes(input.meta.kind)) throw Error('Dataset needs meta.source and meta.kind (demo or riot).');
 const seen = new Set();
 for (const m of input.matches) {
  if(typeof m.id!=='string'||!m.id||seen.has(m.id)) throw Error('Each match needs a unique string ID.');
  seen.add(m.id);
  if(!/^\d+\.\d+$/.test(m.patch)||!Number.isFinite(m.timestamp)||m.timestamp<0||!['solo','flex','clash'].includes(m.queue)||typeof m.region!=='string'||typeof m.cohort!=='string') throw Error('Invalid match patch, timestamp, queue, region, or seed cohort.');
  if(!Array.isArray(m.players)||m.players.length!==10||!Array.isArray(m.bans)||m.bans.length>10||m.bans.some(x=>typeof x!=='string')) throw Error('Every match needs ten players and at most ten champion ban IDs.');
  const champions = new Set();
  for (const team of [100,200]) {
   const ps = m.players.filter(p=>p.team===team);
   if(ps.length!==5||new Set(ps.map(p=>p.role)).size!==5||ps.some(p=>!ROLES.includes(p.role)||typeof p.champion!=='string'||!p.champion||typeof p.win!=='boolean')) throw Error('Each team must have exactly one player per role and a boolean result.');
   if(ps.some(p=>p.win!==ps[0].win)) throw Error('Team results disagree.');
  }
  if(m.players.find(p=>p.team===100).win===m.players.find(p=>p.team===200).win) throw Error('Match must have exactly one winning team.');
  for(const p of m.players) {if(champions.has(p.champion)) throw Error('A champion cannot appear twice in a draft.'); champions.add(p.champion);}
  if(m.bans.some(id=>champions.has(id))) throw Error('A banned champion cannot also be picked.');
 }
 return input;
}
export function aggregate(dataset, filter={}) {
 const matches=dataset.matches.filter(m=>(!filter.patch||m.patch===filter.patch)&&(!filter.region||filter.region==='all'||m.region===filter.region)&&(!filter.cohort||filter.cohort==='all'||m.cohort===filter.cohort)&&(!filter.queue||m.queue===filter.queue));
 const stats=new Map(), allies=new Map(), enemies=new Map(), bans=new Map(), picks=new Map();
 for(const m of matches) {
  for(const id of new Set(m.bans)) bans.set(id,(bans.get(id)||0)+1);
  for(const p of m.players) {
   picks.set(p.champion,(picks.get(p.champion)||0)+1);
   record(stats,`${p.champion}|${p.role}`,p.win);
   for(const q of m.players) {
    if(q.champion===p.champion) continue;
    record(q.team===p.team?allies:enemies,`${p.champion}|${p.role}|${q.champion}|${q.role}`,p.win);
   }
  }
 }
 return {matches,stats,allies,enemies,bans,picks,total:matches.length};
}
export function winInterval(w,n) {
 if(!n) return [0,100];
 const z=1.96,p=w/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,e=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return [100*(c-e),100*(c+e)];
}
export function duoStats(agg, firstRole, secondRole, {minGames=10, first='', second=''}={}) {
 const rows=[];
 for(const [key,pair] of agg.allies) {
  const [a,roleA,b,roleB]=key.split('|');
  if(roleA!==firstRole||roleB!==secondRole||pair.games<minGames||(first&&a!==first)||(second&&b!==second)) continue;
  const statA=agg.stats.get(`${a}|${roleA}`),statB=agg.stats.get(`${b}|${roleB}`);
  const baseline=pairBaseline(shrink(statA.wins,statA.games),shrink(statB.wins,statB.games));
  const adjusted=shrink(pair.wins,pair.games,baseline,120);
  rows.push({a,b,games:pair.games,wins:pair.wins,winRate:pct(pair.wins,pair.games),baseline,adjusted,
   synergy:adjusted-baseline,pickRate:pct(pair.games,agg.total*2),interval:winInterval(pair.wins,pair.games)});
 }
 return rows;
}
export function recommend(agg, {role='MIDDLE',blue={},red={},bans=[],side='blue',minGames=10,weights='balanced',pool=[]}={}) {
 const own=side==='blue'?blue:red, opp=side==='blue'?red:blue;
 const unavailable=new Set([...Object.values(blue),...Object.values(red),...bans].filter(Boolean));
 const settings={balanced:[1,0.55,0.4],lane:[1,0.95,0.2],team:[1,0.35,0.85]}[weights]||[1,0.55,0.4];
 const out=[];
 for(const [key,s] of agg.stats) {
  const [champion,r]=key.split('|');
  if(r!==role||unavailable.has(champion)||s.games<minGames||(pool.length&&!pool.includes(champion))) continue;
  const base=shrink(s.wins,s.games);
  const pairEffects=(map,team,ally)=>Object.entries(team).filter(([rr,id])=>id&&(!ally||rr!==role)).map(([rr,id])=>{
   const pair=map.get(`${champion}|${role}|${id}|${rr}`);
   if(!pair) return null;
   const q=agg.stats.get(`${id}|${rr}`);
   const other=q?shrink(q.wins,q.games):50;
   const expected=pairBaseline(base,ally?other:100-other);
   const residual=shrink(pair.wins,pair.games,expected,120)-expected;
   return {champion:id,role:rr,games:pair.games,winRate:pct(pair.wins,pair.games),delta:residual,weight:(!ally&&rr===role)?1.5:1};
  }).filter(Boolean);
  const counterPairs=pairEffects(agg.enemies,opp,false),synergyPairs=pairEffects(agg.allies,own,true);
  const mean=xs=>xs.length?xs.reduce((v,p)=>v+p.delta*p.weight,0)/xs.reduce((v,p)=>v+p.weight,0):0;
  const counter=mean(counterPairs),synergy=mean(synergyPairs);
  const pickRate=100*(agg.picks.get(champion)||0)/(agg.total||1),banRate=100*(agg.bans.get(champion)||0)/(agg.total||1);
  // Presence is a small, explicit meta tiebreaker; score is not a predicted win probability.
  const presence=Math.min(0.8,Math.log1p(pickRate+banRate)*0.15);
  const score=base+settings[1]*counter+settings[2]*synergy+presence;
  out.push({champion,role,games:s.games,wins:s.wins,winRate:pct(s.wins,s.games),rolePickRate:100*s.games/(agg.total*2||1),pickRate,banRate,base,counter,synergy,presence,score,counterPairs,synergyPairs,interval:winInterval(s.wins,s.games)});
 }
 return out.sort((a,b)=>b.score-a.score||b.games-a.games||a.champion.localeCompare(b.champion));
}
export function recommendBans(agg,{blue={},red={},bans=[],side='blue',minGames=10}={}) {
 const own=side==='blue'?blue:red,opponentSide=side==='blue'?'red':'blue';
 const best=new Map();
 for(const role of ROLES) {
  // An already filled enemy role cannot take another pick, although unfilled roles can flex.
  if((side==='blue'?red:blue)[role]) continue;
  for(const row of recommend(agg,{role,blue,red,bans,side:opponentSide,minGames})) {
   const pressure=Math.min(2,(row.pickRate+row.banRate)/30);
   const candidate={...row,score:row.base+row.counter*0.65+pressure,threatPairs:row.counterPairs,against:Object.values(own).filter(Boolean)};
   if(!best.has(row.champion)||best.get(row.champion).score<candidate.score) best.set(row.champion,candidate);
  }
 }
 return [...best.values()].sort((a,b)=>b.score-a.score||b.games-a.games);
}
