import { ROLES, ROLE_NAMES, FALLBACK, DD, DEFAULT_VERSION, icon } from './catalog.js';
import { aggregate, duoStats, recommend, recommendBans, validateDataset, patchOf } from './engine.js';
import { makeDemo } from './demo.js';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>new Intl.NumberFormat().format(x),fixed=x=>Number(x).toFixed(1),signed=x=>`${x>=0?'+':''}${fixed(x)}`;
const REGIONS={ph2:'Philippines',th2:'Thailand',na1:'North America',euw1:'Europe West',eun1:'Europe Nordic & East',kr:'Korea',br1:'Brazil',jp1:'Japan',la1:'Latin America North',la2:'Latin America South',oc1:'Oceania',tr1:'Türkiye',ru:'Russia',sg2:'Singapore',tw2:'Taiwan',vn2:'Vietnam'};
const roleIcon={TOP:'◇',JUNGLE:'♧',MIDDLE:'◈',BOTTOM:'⌁',UTILITY:'✧'};
const duoPairs=[['BOTTOM','UTILITY'],['MIDDLE','JUNGLE'],['TOP','JUNGLE'],
 ...ROLES.flatMap((first,i)=>ROLES.slice(i+1).map(second=>[first,second])).filter(([first,second])=>
 !['BOTTOM|UTILITY','JUNGLE|MIDDLE','TOP|JUNGLE'].includes(`${first}|${second}`))];
let catalog=[...FALLBACK],version=DEFAULT_VERSION,catalogLive=false,dataset=makeDemo(),agg,rows=[],metaRole='all',metaSort='base',mode='picks',picker=null,pickerRole='all',poolDraft=[],toastTimer;
let localDatasetActive=false,localRefreshBusy=false;
let state={blue:{},red:{},bans:Array(10).fill(null),side:'blue',role:'MIDDLE',pool:[],strategy:'balanced',minGames:10};
try {const saved=JSON.parse(localStorage.getItem('rift-draft-state'));if(saved&&['blue','red'].includes(saved.side)&&ROLES.includes(saved.role)&&saved.blue&&saved.red&&Array.isArray(saved.bans)&&Array.isArray(saved.pool)) {
 const ids=[...Object.values(saved.blue),...Object.values(saved.red),...saved.bans].filter(Boolean);
 if(ids.every(x=>typeof x==='string')&&new Set(ids).size===ids.length) state={...state,...saved,bans:saved.bans.slice(0,10)};
}} catch {}
const name=id=>catalog.find(c=>c.id===id)?.name||id;
const img=(id,extra='')=>`<img src="${esc(icon(id,version))}" alt="" loading="lazy" ${extra}>`;
function save(){try{localStorage.setItem('rift-draft-state',JSON.stringify(state));}catch{}}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function on(id,event,fn){$(id).addEventListener(event,fn);}
function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open('rift-draft',1);r.onupgradeneeded=()=>r.result.createObjectStore('datasets');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function datasetStore(action,value){const d=await db();try{return await new Promise((resolve,reject)=>{const tx=d.transaction('datasets',action==='get'?'readonly':'readwrite');let result;const s=tx.objectStore('datasets');const req=action==='get'?s.get('current'):action==='put'?s.put(value,'current'):s.delete('current');req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{d.close();}}
function filters(){return {queue:$('queue').value,region:$('region').value,cohort:$('cohort').value,patch:$('patch').value};}
function options(id,values,allLabel,labels={}){const select=$(id),old=select.value;select.innerHTML=(allLabel?`<option value="all">${allLabel}</option>`:'')+values.map(x=>`<option value="${esc(x)}">${esc(labels[x]||x)}</option>`).join('');if([...select.options].some(x=>x.value===old))select.value=old;}
function setupFilters(){
 options('region',[...new Set(dataset.matches.map(m=>m.region))].sort(),'All sampled regions',REGIONS);
 options('cohort',[...new Set(dataset.matches.map(m=>m.cohort))].sort(),'All sampled ranks');
 options('patch',[...new Set(dataset.matches.map(m=>m.patch))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})),null,dataset.meta.kind==='demo'?{'0.0':'Demo · synthetic'}:{});
 for(const o of $('queue').options)o.disabled=!dataset.matches.some(m=>m.queue===o.value);
 if($('queue').selectedOptions[0]?.disabled)$('queue').value=[...$('queue').options].find(x=>!x.disabled)?.value||'solo';
}
function renderNotice(){
 const real=dataset.meta.kind==='riot',allPatches=[...new Set(dataset.matches.map(m=>m.patch))];
 const dates=dataset.matches.map(m=>m.timestamp).filter(Boolean),newest=dates.length?Math.max(...dates):0;
 const stale=real&&(!allPatches.includes(patchOf(version))||(newest&&Date.now()-newest>7*864e5));
 const small=real&&agg.total>0&&agg.total<500;
 $('data-notice').classList.toggle('real',real&&!stale&&!small);
 $('data-notice').innerHTML=`<span class="notice-icon">i</span><div><strong>${real?(stale?'Imported sample · check freshness':small?'Early Riot sample · exploratory statistics':'Riot match sample loaded'):'Demo data is active'}</strong><span>${real?`${esc(dataset.meta.source)} · ${fmt(dataset.matches.length)} matches${stale?' · This sample may not represent the current patch.':small?' · Collect more games before drawing meta conclusions.':''}`:'Explore the tool with simulated matches. Import Riot match data for real meta recommendations.'}</span></div><button class="text-button" id="connect-button">${real?'Inspect data':'Connect real data'}</button>`;
 on('connect-button','click',showData);
}
function recompute(){agg=aggregate(dataset,filters());$('match-count').textContent=fmt(agg.total);renderBoard();renderRecommendations();renderMeta();renderDuos();renderNotice();save();}
function tabs(container,selected,all,fn){$(container).innerHTML=(all?`<button class="role-tab ${selected==='all'?'selected':''}" data-role="all" aria-pressed="${selected==='all'}">All roles</button>`:'')+ROLES.map(r=>`<button class="role-tab ${selected===r?'selected':''}" data-role="${r}" aria-pressed="${selected===r}"><span class="role-icon" aria-hidden="true">${roleIcon[r]}</span>${ROLE_NAMES[r]}</button>`).join('');$(container).querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>fn(b.dataset.role));}
function renderBoard(){
 $('draft-slots').innerHTML=ROLES.map(role=>`<div class="draft-row">${['blue','red'].map(side=>{const id=state[side][role];return `<button class="draft-slot ${side==='red'?'red-slot':''} ${state.side===side&&state.role===role?'target':''}" data-side="${side}" data-role="${role}" aria-label="${side} ${ROLE_NAMES[role]}: ${esc(id?name(id):'choose champion')}"><span class="slot-portrait">${id?img(id):roleIcon[role]}</span><span class="slot-copy"><strong class="${id?'':'slot-empty'}">${esc(id?name(id):'Pick champion')}</strong><small>${ROLE_NAMES[role]}${state.side===side&&state.role===role?' · your next pick':''}</small></span></button>`;}).join('')}</div>`).join('');
 $('draft-slots').querySelectorAll('[data-side]').forEach(b=>b.onclick=()=>openPicker({side:b.dataset.side,role:b.dataset.role}));
 $('ban-slots').innerHTML=Array.from({length:10},(_,i)=>`<button class="ban-slot ${state.bans[i]?'filled':''}" data-index="${i}" aria-label="Ban slot ${i+1}: ${esc(state.bans[i]?name(state.bans[i]):'empty')}">${state.bans[i]?img(state.bans[i]):'+'}</button>`).join('');
 $('ban-slots').querySelectorAll('[data-index]').forEach(b=>b.onclick=()=>openPicker({ban:Number(b.dataset.index)}));
 const count=Object.values(state.blue).filter(Boolean).length+Object.values(state.red).filter(Boolean).length;
 $('draft-progress').textContent=`${count} / 10 champions picked`;
 for(const side of ['blue','red']){$(`side-${side}`).classList.toggle('selected',state.side===side);$(`side-${side}`).setAttribute('aria-pressed',state.side===side);}
 $('pool-title').textContent=state.pool.length?`${state.pool.length} champions in your pool.`:'Play what you know.';
 $('pool-text').textContent=state.pool.length?'Pick recommendations are limited to your saved pool. Ban recommendations still consider every champion.':'Keep recommendations inside your comfort zone with a personal champion pool.';
 $('coverage-title').textContent=count?`${count} picks. Every role considered.`:'All five roles. Both teams.';
 $('coverage-text').textContent=count?'The model checks observed pair results against every selected ally and enemy, with extra weight on the lane opponent.':'Select champions on the board to include ally synergy and cross-lane enemy matchups.';
}
function recommendationOptions(){return {role:state.role,blue:state.blue,red:state.red,bans:state.bans,side:state.side,minGames:state.minGames,weights:state.strategy,pool:state.pool};}
function renderRecommendations(){
 tabs('role-tabs',state.role,false,r=>{state.role=r;renderBoard();renderRecommendations();save();});
 $('role-tabs').hidden=mode==='bans';$('strategy').disabled=mode==='bans';
 rows=mode==='picks'?recommend(agg,recommendationOptions()):recommendBans(agg,recommendationOptions());
 const canExplore=!rows.length&&state.minGames>1&&(mode==='picks'?recommend(agg,{...recommendationOptions(),minGames:1}):recommendBans(agg,{...recommendationOptions(),minGames:1})).length>0;
 $('recommend-title').textContent=mode==='picks'?'Recommended picks':'Recommended bans';
 $('picks-tab').classList.toggle('selected',mode==='picks');$('bans-tab').classList.toggle('selected',mode==='bans');
 $('picks-tab').setAttribute('aria-pressed',mode==='picks');$('bans-tab').setAttribute('aria-pressed',mode==='bans');
 const selected=state[state.side][state.role];
 $('rec-context').textContent=mode==='picks'?`${ROLE_NAMES[state.role]} · ${state.side==='blue'?'Blue':'Red'} team${selected?` · replacing ${name(selected)}`:''} · ${dataset.meta.kind==='demo'?'Simulated statistics':'Observed match statistics'}${state.pool.length?' · Your pool only':''}`:`Threats across unfilled enemy roles · ${dataset.meta.kind==='demo'?'Simulated statistics':'Observed match statistics'}`;
 $('recommendations').innerHTML=rows.length?rows.slice(0,5).map((r,i)=>`<div class="recommendation" role="button" tabindex="0" data-index="${i}" aria-label="Inspect ${esc(name(r.champion))}"><div class="champion-summary"><span class="rank-number">${i+1}</span>${img(r.champion)}<div><strong>${esc(name(r.champion))}</strong><small>${mode==='bans'?ROLE_NAMES[r.role]+' threat':i===0?'Highest draft score':r.counter>0.25?'Favorable enemy matchups':r.synergy>0.25?'Fits your selected allies':'Meta strength'} · ${fmt(r.games)} games</small></div></div><div class="rate">${fixed(r.winRate)}%<small>observed WR</small></div><div class="score"><strong>${fixed(r.score)}</strong><small>ranking points</small></div></div>`).join(''):`<div class="empty"><strong>${agg.total?'No eligible champions':'No matches for these filters'}</strong>${agg.total?'Try a lower minimum sample, another role, or a wider champion pool. Picked and banned champions are excluded.':'Choose a region, seed rank, and queue present in the dataset, or import a broader sample.'}</div>`;
 if(canExplore){const button=document.createElement('button');button.className='button quiet';button.style.margin='0 24px 24px';button.textContent='Explore results with 1+ games';button.onclick=()=>{state.minGames=1;$('min-games').value='1';renderRecommendations();save();toast('Exploratory mode: small samples are highly uncertain.');};$('recommendations').append(button);}
 $('recommendations').querySelectorAll('[data-index]').forEach(el=>{const fn=()=>showChampion(rows[Number(el.dataset.index)],true);el.onclick=fn;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}};});
 $('confidence-title').textContent=rows.length?`${fmt(rows[0].games)} games behind the top choice.`:'Samples matter.';
 $('confidence-text').textContent=rows.length?`Observed win-rate interval: ${fixed(rows[0].interval[0])}–${fixed(rows[0].interval[1])}%. This describes the sample, not your chance of winning.`:'Small samples are pulled toward their baseline. A high win rate over a few games gets less weight.';
}
function renderMeta(){
 tabs('meta-roles',metaRole,true,r=>{metaRole=r;renderMeta();});
 const query=$('meta-search').value.trim().toLowerCase();
 const minGames=Number($('meta-min-games').value);
 const byStrength=(a,b)=>b.base-a.base||b.games-a.games||a.champion.localeCompare(b.champion);
 const byRole=ROLES.map(role=>recommend(agg,{role,minGames}).sort(byStrength));
 $('meta-sample').textContent=`${fmt(agg.total)} ${dataset.meta.kind==='demo'?'simulated':'saved'} matches in the selected filters. Adjusted win rate pulls small samples toward 50%.`;
 $('meta-leaders').innerHTML=ROLES.map((role,index)=>{
  const lead=byRole[index][0];
  return `<article class="insight-card"><h3>${ROLE_NAMES[role]}</h3>${lead?`<div class="champion-summary">${img(lead.champion)}<div><strong>${esc(name(lead.champion))}</strong><small>${fixed(lead.winRate)}% wins · ${fmt(lead.games)} games</small></div></div>`:'<p>No picks meet the game minimum.</p>'}</article>`;
 }).join('');
 const all=byRole.flat().filter(row=>(metaRole==='all'||metaRole===row.role)&&name(row.champion).toLowerCase().includes(query));
 all.sort((a,b)=>b[metaSort]-a[metaSort]||byStrength(a,b));
 $('meta-table').innerHTML=all.map((r,i)=>`<tr tabindex="0" data-index="${i}"><td>${img(r.champion)}${esc(name(r.champion))}</td><td>${ROLE_NAMES[r.role]}</td><td>${fixed(r.base)}%</td><td>${fixed(r.winRate)}%</td><td>${fixed(r.rolePickRate)}%</td><td>${fixed(r.banRate)}%</td><td>${fmt(r.games)}</td></tr>`).join('')||'<tr><td colspan="7">No champions match these filters. Try a lower game minimum or a wider sample.</td></tr>';
 $('meta-table').querySelectorAll('[data-index]').forEach(el=>{el.onclick=()=>showChampion(all[Number(el.dataset.index)],false);el.onkeydown=e=>{if(e.key==='Enter')el.click();};});
}
function renderDuos(){
 if($('duos-view').hidden||!agg)return;
 const [firstRole,secondRole]=duoPairs[Number($('duo-roles').value)]||duoPairs[0];
 for(const [side,role] of [['first',firstRole],['second',secondRole]]){
  const field=$(`duo-${side}`),current=field.value;
  const champions=[...agg.stats.keys()].map(key=>key.split('|')).filter(([,r])=>r===role).map(([id])=>id).sort((a,b)=>name(a).localeCompare(name(b)));
  field.replaceChildren(new Option('All champions',''),...champions.map(id=>new Option(name(id),id)));
  if(champions.includes(current))field.value=current;
  $(`duo-${side}-label`).textContent=`${ROLE_NAMES[role]} champion`;
  $(`duo-th-${side}`).textContent=ROLE_NAMES[role];
 }
 const minGames=Number($('duo-min').value),sort=$('duo-sort').value;
 const pairs=duoStats(agg,firstRole,secondRole,{minGames,first:$('duo-first').value,second:$('duo-second').value});
 pairs.sort((a,b)=>b[sort]-a[sort]||b.games-a.games||a.a.localeCompare(b.a)||a.b.localeCompare(b.b));
 $('duo-sample').textContent=`${fmt(pairs.length)} eligible pairs across ${fmt(agg.total)} ${dataset.meta.kind==='demo'?'simulated':'saved'} matches in the selected filters.${pairs.length>100?' Showing the first 100.':''}`;
 const champion=id=>`${img(id)}${esc(name(id))}`;
 $('duo-body').innerHTML=pairs.slice(0,100).map(p=>`<tr><td>${champion(p.a)}</td><td>${champion(p.b)}</td><td title="95% interval: ${fixed(p.interval[0])}–${fixed(p.interval[1])}%">${fixed(p.winRate)}%</td><td>${fixed(p.adjusted)}%</td><td>${signed(p.synergy)} pp</td><td>${fixed(p.pickRate)}%</td><td>${fmt(p.games)}</td></tr>`).join('')||'<tr><td colspan="7">No pairs meet these filters. Try a lower game minimum or a wider sample.</td></tr>';
}

const queueNames={solo:'Ranked solo / duo',flex:'Ranked flex'};
function displayProfile(profile){
 const ranks=Object.entries(queueNames).map(([queue,label])=>{
  const rank=profile.ranks[queue];
  return `<article class="insight-card"><h3>${label}</h3>${rank?`<strong>${esc(rank.tier)} ${esc(rank.rank)} · ${fmt(rank.leaguePoints??0)} LP</strong><p>${fmt(rank.wins??0)} wins · ${fmt(rank.losses??0)} losses</p>`:'<p>Unranked on this server</p>'}</article>`;
 }).join('');
 const completed=profile.matches.filter(m=>!m.gameEndedInEarlySurrender&&typeof m.win==='boolean');
 const wins=completed.filter(m=>m.win).length;
 const dateOf=value=>Number.isFinite(value)?new Date(value).toLocaleDateString():'—';
 const games=profile.matches.map(m=>`<tr><td>${typeof m.championName==='string'&&/^[A-Za-z0-9]+$/.test(m.championName)?img(m.championName):''}${esc(name(m.championName)||'Unknown')}</td><td>${esc(ROLE_NAMES[m.teamPosition]||'—')}</td><td>${m.gameEndedInEarlySurrender?'Remake':m.win===true?'Win':m.win===false?'Loss':'—'}</td><td>${[m.kills,m.deaths,m.assists].map(n=>Number.isFinite(n)?fmt(n):'—').join(' / ')}</td><td>${dateOf(m.timestamp)}</td></tr>`).join('');
 $('profile-status').textContent=`${profile.name}#${profile.tag} · ${REGIONS[profile.platform]||profile.platform}`;
 $('profile-result').innerHTML=`<div class="profile-ranks">${ranks}</div><div class="section-heading"><h3>Recent ${esc(queueNames[profile.queue]||'ranked')} matches</h3></div>${games?`<p class="rec-context">${fmt(wins)} wins across ${fmt(completed.length)} completed games shown.</p><div class="table-wrap"><table><thead><tr><th>Champion</th><th>Role</th><th>Result</th><th>K / D / A</th><th>Date</th></tr></thead><tbody>${games}</tbody></table></div>`:'<p class="rec-context">No recent matches found for this queue and server.</p>'}`;
}

async function lookupProfile(event){
 event.preventDefault();
 $('profile-result').replaceChildren();
 if(!['localhost','127.0.0.1'].includes(location.hostname)){
  $('profile-status').textContent='Live player lookup is available in the local Draftweaver app. Open it with START.cmd.';
  return;
 }
 $('profile-submit').disabled=true;
 $('profile-status').textContent='Fetching the player’s rank and recent matches…';
 try{
  const response=await fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json','X-Draftweaver-Request':'profile'},body:JSON.stringify({riotId:$('profile-id').value.trim(),platform:$('profile-region').value,queue:$('profile-queue').value})});
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Restart the local app with the updated START.cmd to enable profile lookup.');
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Profile lookup failed.');
  displayProfile(data);
 }catch(error){$('profile-status').textContent=error.message||'Profile lookup failed.';}
 finally{$('profile-submit').disabled=false;}
}
function openPicker(target){picker=target;pickerRole=target.role||'all';poolDraft=[...state.pool];$('champ-search').value='';$('picker-title').textContent=target.pool?'Your champion pool':target.ban!==undefined?`Ban slot ${target.ban+1}`:`${target.side==='blue'?'Blue':'Red'} team · ${ROLE_NAMES[target.role]}`;$('clear-slot').hidden=!!target.pool;$('done-pool').hidden=!target.pool;renderPicker();$('picker-dialog').showModal();$('champ-search').focus();}
function renderPicker(){
 tabs('picker-roles',pickerRole,true,r=>{pickerRole=r;renderPicker();});
 const used=new Set([...Object.values(state.blue),...Object.values(state.red),...state.bans].filter(Boolean));
 const current=picker.ban!==undefined?state.bans[picker.ban]:picker.side?state[picker.side][picker.role]:null;used.delete(current);
 const q=$('champ-search').value.trim().toLowerCase();
 const available=catalog.filter(c=>!q||c.name.toLowerCase().includes(q)||c.id.toLowerCase().includes(q)).filter(c=>pickerRole==='all'||c.roles?.includes(pickerRole)||agg.stats.has(`${c.id}|${pickerRole}`)).sort((a,b)=>a.name.localeCompare(b.name));
 $('picker-hint').textContent=picker.pool?`${poolDraft.length} selected. An empty pool allows all champions.`:'Role hints are a starting point. Use All roles to choose a flex pick. Picked and banned champions are unavailable.';
 $('champion-grid').innerHTML=available.map(c=>`<button class="champion-option ${picker.pool&&poolDraft.includes(c.id)?'chosen':''}" data-id="${esc(c.id)}" ${!picker.pool&&used.has(c.id)?'disabled':''} ${picker.pool?`aria-pressed="${poolDraft.includes(c.id)}"`:''}>${img(c.id)}<span>${esc(c.name)}</span></button>`).join('')||'<p class="muted">No champions match this search.</p>';
 $('champion-grid').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{const id=b.dataset.id;if(picker.pool){poolDraft=poolDraft.includes(id)?poolDraft.filter(x=>x!==id):[...poolDraft,id];renderPicker();}else{if(picker.ban!==undefined)state.bans[picker.ban]=id;else state[picker.side][picker.role]=id;$('picker-dialog').close();recompute();}});
}
function showInfo(title,html){$('info-title').textContent=title;$('info-content').innerHTML=html;if(!$('info-dialog').open)$('info-dialog').showModal();}
function showChampion(r,canApply){
 const pairList=xs=>xs.length?xs.map(p=>`<div class="breakdown"><span>${esc(name(p.champion))} · ${ROLE_NAMES[p.role]}<br><small>${fmt(p.games)} pair games · ${fixed(p.winRate)}% observed WR</small></span><strong>${signed(p.delta)} pts</strong></div>`).join(''):'<p>No observed pair games with the selected champions. No pair adjustment applied.</p>';
 const w={balanced:[.55,.4],lane:[.95,.2],team:[.35,.85]}[state.strategy]||[.55,.4];
 showInfo(`${name(r.champion)} · ${ROLE_NAMES[r.role]}`,`<div class="detail-hero">${img(r.champion)}<div><strong>${fixed(r.score)} <small>draft score</small></strong><span>Ranking points, not a predicted win probability.</span></div></div><div class="metric-grid"><div class="metric"><span>Win rate</span><strong>${fixed(r.winRate)}%</strong></div><div class="metric"><span>Role games</span><strong>${fmt(r.games)}</strong></div><div class="metric"><span>Ban rate</span><strong>${fixed(r.banRate)}%</strong></div></div><p>95% Wilson interval: ${fixed(r.interval[0])}–${fixed(r.interval[1])}%. Role pick rate: ${fixed(r.rolePickRate)}%. Champion presence: ${fixed(r.pickRate+r.banRate)}% of matches.</p><h3>Score breakdown</h3><div class="breakdown"><span>Win rate, smoothed with 80 prior games at 50%</span><strong>${fixed(r.base)}</strong></div><div class="breakdown"><span>Enemy matchup adjustment × ${mode==='bans'&&canApply?'.65':w[0]}</span><strong>${signed(r.counter*(mode==='bans' && canApply ? 0.65 : w[0]))}</strong></div>${mode==='bans'&&canApply?'':`<div class="breakdown"><span>Ally synergy adjustment × ${w[1]}</span><strong>${signed(r.synergy*w[1])}</strong></div>`}<div class="breakdown"><span>${mode==='bans'&&canApply?'Pick / ban pressure':'Meta presence tiebreaker'}</span><strong>${signed(mode==='bans'&&canApply?Math.min(2,(r.pickRate+r.banRate)/30):r.presence)}</strong></div><h3>Enemy matchups · every lane</h3>${pairList(r.counterPairs)}<h3>Ally synergy · every lane</h3>${pairList(r.synergyPairs)}<p>Pair adjustments account for both champions’ baseline strength and shrink residuals with 120 prior pair games. Pair data is observational and can be sparse.</p>${dataset.meta.kind==='demo'?'<p><strong>These statistics are synthetic demonstration data.</strong></p>':''}${canApply?`<button class="button primary" id="apply-champion">${mode==='bans'?'Add ban':`Pick ${esc(name(r.champion))}`}</button>`:''}`);
 if(canApply)on('apply-champion','click',()=>{if(mode==='bans'){const slot=state.bans.findIndex(x=>!x);if(slot<0){toast('All ban slots are filled. Clear a slot first.');return;}state.bans[slot]=r.champion;}else{state[state.side][state.role]=r.champion;}recompute();$('info-dialog').close();});
}
function showMethod(){showInfo('How recommendations work',`<h3>Current patch, explicit sample</h3><p>Statistics use only matches matching the patch, region, seed rank, and queue you select. Every role is inferred from Riot’s recorded team position. Banned and picked champions cannot be recommended.</p><h3>Pick ranking</h3><p>Draft score = smoothed role win rate + enemy adjustment × weight + ally adjustment × weight + presence tiebreaker. It is a ranking score, not a forecast.</p><ul><li>Role win rate uses 80 prior games at 50% to temper small samples.</li><li>Every selected enemy and ally is checked for observed pair results. An enemy in your role has 1.5× weight within the enemy average.</li><li>Pair results are adjusted for both champions’ baseline strengths, then shrunk with 120 prior pair games. Missing pairs contribute no adjustment.</li><li>Balanced weights: enemy 0.55, ally 0.40. Matchup weights: 0.95 / 0.20. Synergy weights: 0.35 / 0.85.</li><li>Presence adds min(0.8, 0.15 × ln(1 + pick% + ban%)) points. Popularity is a small tiebreaker.</li></ul><h3>Ban ranking</h3><p>We rank the strongest eligible opponent in every unfilled enemy role. Score = smoothed strength + counter adjustment against your selected allies × 0.65 + min(2, (pick% + ban%) / 30). A champion’s highest-scoring role determines their ban rank.</p><h3>What the data can tell you</h3><p>Matches are observational, not a controlled experiment. Player skill, champion mastery, side and matchmaking can confound results. The model gives several choices; your familiarity and game plan still matter.</p><p>Seed rank refers to the sampled player’s ladder rank at collection time. It does not verify the rank of every participant. Clash is its own sample and should not be treated as solo queue.</p>`);}
function showData(){
 const real=dataset.meta.kind==='riot',times=dataset.matches.map(m=>m.timestamp).filter(Boolean),start=times.length?new Date(Math.min(...times)).toLocaleDateString():null,end=times.length?new Date(Math.max(...times)).toLocaleDateString():null;
 showInfo('Data & sources',`<h3>${real?'Imported Riot match sample':'Synthetic demonstration dataset'}</h3><p>${esc(dataset.meta.source)}. ${fmt(dataset.matches.length)} deduplicated matches in the file.${start?` Games dated ${start}–${end}.`:''}</p><p>${esc(dataset.meta.cohortMethod||'Rank metadata describes sampled seed players, not all lobby participants.')}</p><p>${real?'Imported files are trusted as supplied; their provenance cannot be independently verified by this browser.':'The included matches and outcomes are fictional. They demonstrate scoring and interactions and do not describe the current meta.'}</p><button class="button primary" id="import-button">Import match dataset</button><button class="button quiet" id="export-button">Export current dataset</button>${real?'<button class="button quiet" id="demo-button">Use demo data</button>':''}<h3>Collect real statistics</h3><p>Download the Python collector, set <code>RIOT_API_KEY</code> in your local environment, then run it. Your key stays on your computer. The hosted app only reads the resulting match data.</p><p><a href="collect.py" download>Download Riot collector (Python 3.10+)</a> · <a href="https://developer.riotgames.com/" target="_blank" rel="noreferrer">Get a Riot development key</a></p><pre><code>python collect.py --regions na1 euw1 kr \
  --tiers EMERALD DIAMOND MASTER \
  --queues solo flex --max-matches 1000 \
  --output data.json</code></pre><p>Use <code>--regions all --tiers all --queues all</code> for all supported regions, rank seed cohorts, solo, flex and Clash. Collection obeys API limits and may take hours for broad samples. Include <code>--watch-minutes 360</code> to refresh every six hours while the collector stays running. Reimport the new file after collection.</p><p>For Clash, provide known participant PUUIDs with <code>--seeds seeds.json</code>. The collector also checks sampled ladder seeds, but they may have no Clash games. It will never substitute solo matches for Clash.</p><p>The app remembers your imported dataset on this browser. On local hosting, the app also loads <code>data.json</code> beside <code>index.html</code> if there is no saved import. Hosted data refresh requires reimporting or publishing a new snapshot; no automatic cloud collection is configured.</p><h3>Official data</h3><p>Champion names and portraits use <a href="https://developer.riotgames.com/docs/lol#data-dragon" target="_blank" rel="noreferrer">Riot Data Dragon</a>. The catalog checks the latest asset version independently of the imported statistics patch. ${catalogLive?'Latest catalog request succeeded.':'Catalog network refresh has not succeeded; bundled role hints remain available.'}</p>`);
 const reload=document.createElement('button');reload.className='button quiet';reload.textContent='Load latest collection';reload.onclick=async()=>{if(await loadCollectedData(false)){showData();toast('Latest local collection loaded.');}};$('info-content').prepend(reload);
 const status=dataset.meta.collection;
 if(status&&typeof status==='object'){const section=document.createElement('div');section.innerHTML=`<h3>Collection progress</h3><p>${fmt(status.matches||0)} / ${fmt(status.target||0)} target matches · ${esc(status.state||'unknown')}. Counts below describe the sampled player’s seed rank.</p>${Object.entries(status.rankCounts||{}).map(([tier,count])=>`<div class="breakdown"><span>${esc(tier)}</span><strong>${fmt(Number(count)||0)} matches</strong></div>`).join('')}`;$('info-content').prepend(section);}
 on('import-button','click',()=>$('import-file').click());on('export-button','click',()=>download(dataset,'draftweaver-dataset.json'));
 if(real)on('demo-button','click',async()=>{dataset=makeDemo();localDatasetActive=false;try{localStorage.setItem('draftweaver-data-source','demo');}catch{}try{await datasetStore('delete');}catch{}setupFilters();recompute();$('info-dialog').close();toast('Demo data restored.');});
}
function download(value,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
for(const id of ['queue','region','cohort','patch'])on(id,'change',recompute);
for(const side of ['blue','red'])on(`side-${side}`,'click',()=>{state.side=side;recompute();});
on('strategy','change',()=>{state.strategy=$('strategy').value;renderRecommendations();save();});
on('min-games','change',()=>{state.minGames=Number($('min-games').value);renderRecommendations();save();});
on('picks-tab','click',()=>{mode='picks';renderRecommendations();});on('bans-tab','click',()=>{mode='bans';renderRecommendations();});
on('pool-button','click',()=>openPicker({pool:true}));on('champ-search','input',renderPicker);
on('done-pool','click',()=>{state.pool=[...poolDraft];$('picker-dialog').close();recompute();});
on('clear-slot','click',()=>{if(picker.ban!==undefined)state.bans[picker.ban]=null;else delete state[picker.side][picker.role];$('picker-dialog').close();recompute();});
on('reset','click',()=>{state.blue={};state.red={};state.bans=Array(10).fill(null);recompute();toast('Draft cleared.');});
on('example','click',()=>{state.blue={TOP:'Ornn',JUNGLE:'JarvanIV',BOTTOM:'Jinx',UTILITY:'Lulu'};state.red={TOP:'Gwen',JUNGLE:'Viego',MIDDLE:'Sylas',BOTTOM:'Kaisa',UTILITY:'Nautilus'};state.bans=['Yone','Darius','Draven','LeeSin',null,null,null,null,null,null];state.side='blue';state.role='MIDDLE';recompute();toast('Example loaded. Select a mid pick to complete blue team.');});
on('data-button','click',showData);on('method-button','click',showMethod);on('about-button','click',showMethod);
on('meta-search','input',renderMeta);on('meta-min-games','change',renderMeta);
document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{metaSort=b.dataset.sort;renderMeta();});
function showCurrentView(){
 const views=['draft','meta','duos','profile'];
 const view=views.find(id=>location.hash===`#${id}`)||'draft';
 for(const id of views) $(`${id}-view`).hidden=id!==view;
 document.querySelectorAll('[data-view]').forEach(button=>{
  const active=button.dataset.view===view;
  button.classList.toggle('active',active);
  if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 });
 if(view==='duos')renderDuos();
 if(view==='profile'&&!['localhost','127.0.0.1'].includes(location.hostname)){
  $('profile-submit').disabled=true;
  $('profile-status').textContent='Live player lookup is available in the local Draftweaver app. Open it with START.cmd.';
 }
}
$('duo-roles').replaceChildren(...duoPairs.map(([a,b],i)=>new Option(`${ROLE_NAMES[a]} + ${ROLE_NAMES[b]}`,i)));
for(const field of ['duo-first','duo-second','duo-min','duo-sort'])on(field,'change',renderDuos);
on('duo-roles','change',()=>{$('duo-first').value='';$('duo-second').value='';renderDuos();});
options('profile-region',Object.keys(REGIONS),null,REGIONS);$('profile-region').value='na1';
on('profile-form','submit',lookupProfile);
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{location.hash=button.dataset.view;});
window.addEventListener('hashchange',showCurrentView);showCurrentView();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}));
on('import-file','change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>35*1024*1024)throw Error('Choose a JSON file smaller than 35 MB.');const data=validateDataset(JSON.parse(await file.text()));dataset=data;localDatasetActive=false;try{localStorage.setItem('draftweaver-data-source','import');}catch{}for(const m of data.matches)for(const p of m.players)if(!catalog.some(c=>c.id===p.champion))catalog.push({id:p.champion,name:p.champion,roles:[p.role]});setupFilters();recompute();try{await datasetStore('put',data);toast('Dataset imported and saved on this browser.');}catch{toast('Dataset loaded for this visit. Browser storage is unavailable.');}$('info-dialog').close();}catch(error){toast(`Import failed: ${error.message}`);}finally{e.target.value='';}});
async function loadCatalog(){try{const versions=await fetch(`${DD}/api/versions.json`,{signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw Error();return r.json();});const v=versions[0];if(!/^\d+\.\d+\.\d+$/.test(v))throw Error();const data=await fetch(`${DD}/cdn/${v}/data/en_US/champion.json`,{signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw Error();return r.json();});catalog=Object.values(data.data).map(c=>({id:c.id,name:c.name,roles:FALLBACK.find(x=>x.id===c.id)?.roles||[]}));version=v;catalogLive=true;$('catalog-status').textContent=`Champion catalog · ${v}`;renderNotice();renderBoard();renderRecommendations();renderMeta();renderDuos();}catch{$('catalog-status').textContent='Catalog offline · bundled role hints';}}
async function loadCollectedData(silent=false){try{const response=await fetch('data.json',{cache:'no-cache'});if(!response.ok)throw Error('No local collection found yet. Run COLLECT.cmd first.');const data=validateDataset(await response.json());dataset=data;localDatasetActive=true;try{localStorage.setItem('draftweaver-data-source','local');}catch{}setupFilters();recompute();return true;}catch(error){if(!silent)toast(error.message);return false;}}
async function restoreDataset(){let preferLocal=false;try{preferLocal=localStorage.getItem('draftweaver-data-source')==='local';}catch{}if(preferLocal&&await loadCollectedData(true))return;try{const saved=await datasetStore('get');if(saved){dataset=validateDataset(saved);localDatasetActive=false;setupFilters();recompute();return;}}catch{}await loadCollectedData(true);}
setInterval(async()=>{if(!localDatasetActive||document.hidden||localRefreshBusy)return;localRefreshBusy=true;try{const response=await fetch('data.status.json',{cache:'no-cache'});if(response.ok){const status=await response.json();if(status.generatedAt&&status.generatedAt!==dataset.meta.generatedAt)await loadCollectedData(true);}}catch{}finally{localRefreshBusy=false;}},30000);
// Broken external portraits fall back to a neutral icon, never a broken image frame.
document.addEventListener('error',e=>{if(e.target.tagName==='IMG'){e.target.src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%23243142'/%3E%3Cpath d='m40 15 20 25-20 25-20-25z' fill='none' stroke='%237c91ab' stroke-width='3'/%3E%3C/svg%3E";}},true);
$('strategy').value=state.strategy;$('min-games').value=state.minGames;setupFilters();recompute();loadCatalog();restoreDataset();
