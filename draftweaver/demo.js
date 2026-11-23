import { ROLES } from './catalog.js';
export function makeDemo() {
 const pools={TOP:['Aatrox','Camille','Darius','Fiora','Garen','Gwen','Jax','Malphite','Ornn','Renekton'],JUNGLE:['Amumu','Diana','Graves','JarvanIV','Kayn','Khazix','LeeSin','Lillia','Viego','Vi'],MIDDLE:['Ahri','Akali','Annie','Aurora','Hwei','Orianna','Sylas','Syndra','Viktor','Yone'],BOTTOM:['Ashe','Caitlyn','Draven','Ezreal','Jhin','Jinx','Kaisa','Lucian','MissFortune','Xayah'],UTILITY:['Braum','Janna','Leona','Lulu','Nami','Nautilus','Rakan','Rell','Senna','Thresh']};
 let seed=4973;
 const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const choose=xs=>xs[Math.floor(rng()*xs.length)];
 const matches=[];
 const all=Object.values(pools).flat();
 for(let i=0;i<4200;i++) {
  const players=[];
  for(const team of [100,200]) for(const role of ROLES) {
   const available=pools[role].filter(id=>!players.some(p=>p.champion===id));
   players.push({champion:choose(available),team,role,win:false});
  }
  const power=team=>players.filter(p=>p.team===team).reduce((v,p)=>v+(pools[p.role].indexOf(p.champion)%4)*0.13,0);
  const b=players.filter(p=>p.team===100).map(p=>p.champion),r=players.filter(p=>p.team===200).map(p=>p.champion);
  const bonus=ids=>(ids.includes('Jinx')&&ids.includes('Lulu')?0.45:0)+(ids.includes('Orianna')&&ids.includes('JarvanIV')?0.5:0);
  const win=rng()<1/(1+Math.exp(-(power(100)-power(200)+bonus(b)-bonus(r))));
  for(const p of players) p.win=p.team===100?win:!win;
  const banned=[];
  const eligible=all.filter(id=>!players.some(p=>p.champion===id));
  while(banned.length<10){const id=choose(eligible);if(!banned.includes(id))banned.push(id);}
  matches.push({id:`DEMO_${i}`,patch:'demo',region:['na1','euw1','kr'][i%3],cohort:['EMERALD','DIAMOND','MASTER'][Math.floor(i/3)%3],queue:i%11===0?'clash':i%5===0?'flex':'solo',timestamp:0,bans:banned,players});
 }
 // "demo" deliberately cannot be confused with an actual patch.
 for(const m of matches) m.patch='0.0';
 return {schemaVersion:1,meta:{kind:'demo',source:'Synthetic demonstration — not live League statistics',generatedAt:new Date(0).toISOString(),cohortMethod:'Fictional seed ranks and outcomes. Do not use to judge the current meta.'},matches};
}
