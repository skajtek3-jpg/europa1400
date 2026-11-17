import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {loadWorld} from '../js/data.mjs';
import {createGame,declareWar,tickDay,warScore} from '../js/game.mjs';

test('trzyletnia kampania na pełnej mapie: ekonomia, AI, wojny i integralność',async()=>{
 globalThis.fetch=async()=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(new URL('../data/provinces.json',import.meta.url)))});
 const W=await loadWorld(),pol=W.countries.find(c=>c?.name==='Poland'),enemy=W.countries.find(c=>c?.name==='Teutonic Order');
 const G=createGame(W,pol.id);declareWar(G,pol.id,enemy.id);
 const oldRandom=Math.random;let seed=1400;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 try{
  for(let d=0;d<1095;d++){
   tickDay(G);
   for(const a of G.armies){assert(Number.isFinite(a.size)&&a.size>0);assert(Number.isFinite(a.morale));assert(a.morale>=0&&a.morale<=1);assert(W.prov[a.prov]);if(a.path?.length)assert(W.prov[a.prov].links.some(l=>l.to===a.path[0]));}
   for(const c of W.countries)if(c){assert(Number.isFinite(c.gold));assert(Number.isFinite(c.manpower));assert(c.provs.every(id=>W.prov[id].owner===c.id));assert(c.wars.every(w=>G.wars.includes(w)));}
   for(const w of G.wars){assert(!w.att.some(id=>w.def.includes(id)));assert(Number.isFinite(warScore(G,w,w.lead.a)));}
  }
 }finally{Math.random=oldRandom;}
 for(const p of W.prov)if(p)assert(p.cells.every(i=>G.ctrl[i]===p.controller));
 console.log(`Kampania: ${G.day} dni, ${G.armies.length} armii, ${G.wars.length} wojen; ${W.components} komponentów po przeprawach.`);
});
