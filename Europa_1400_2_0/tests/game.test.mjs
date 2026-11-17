import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {loadWorld} from '../js/data.mjs';
import * as api from '../js/game.mjs';
import {syncFrontKnights} from '../js/front.mjs';
import {diploAction,getRel,canPass,separatePeace} from '../js/diplo.mjs';
const source=JSON.parse(fs.readFileSync(new URL('../data/provinces.json',import.meta.url)));
const fixture=()=>({W:60,H:10,LON0:0,LON1:6,LAT0:45,LAT1:46,
 countries:[{id:1,name:'A',plName:'A',color:'#aa7777'},{id:2,name:'B',plName:'B',color:'#77aa77'},{id:3,name:'C',plName:'C',color:'#7777aa'}],
 provinces:Array.from({length:6},(_,i)=>({id:i+1,c:i<2?1:i<4?2:3,name:'P'+(i+1),cx:i*10+5,cy:5,dev:10,fort:0,coastal:0,adj:[i,i+2].filter(x=>x>=1&&x<=6)})),
 rle:Array.from({length:10},()=>Array.from({length:6},(_,i)=>[i+1,10]).flat()).flat()});
async function game(json=fixture()){
 globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(json)});
 const world=await loadWorld(),G=api.createGame(world,1);G.armies=[];G.day=1;
 for(const c of world.countries)if(c){c.ai=false;c.allies.clear();c.gold=5000;c.manpower=100000;}
 for(const p of world.prov)if(p)for(const l of p.links)l.days=2;
 return G;
}
function war(G){assert.equal(api.declareWar(G,1,2),true);return G.wars[0];}
const days=(G,n)=>{for(let i=0;i<n;i++)api.tickDay(G);};

test('ścieżka bez pustego kroku i po najkrótszym czasie',async()=>{const G=await game();assert.deepEqual(api.findPath(G,1,3,()=>true),[2,3]);G.world.prov[1].links.push({to:3,days:20,sea:false});assert.deepEqual(api.findPath(G,1,3,()=>true),[2,3]);assert.deepEqual(api.findPath(G,1,1),[]);assert.equal(api.findPath(G,1,99),null);});
test('marsz zajmuje pustą prowincję, także z fortem; kolor zgodny z kontrolą',async()=>{const G=await game();war(G);G.world.prov[3].fort=3;const a=api.spawnArmy(G,1,2,4000,true);assert(api.playerMoveArmy(G,a,3));days(G,2);assert.equal(a.prov,3);assert.equal(G.world.prov[3].controller,1);assert.equal(G.world.prov[3].owner,2);assert(G.world.prov[3].cells.every(i=>G.ctrl[i]===1));});
test('okupacja nie znika po odejściu wojska',async()=>{const G=await game();war(G);const a=api.spawnArmy(G,1,3,4000,true);days(G,1);a.prov=2;days(G,35);assert.equal(G.world.prov[3].controller,1);});
test('własna prowincja jest wyzwalana po wejściu',async()=>{const G=await game();war(G);G.world.prov[2].controller=2;syncFrontKnights(G);const a=api.spawnArmy(G,1,1,4000,true);api.playerMoveArmy(G,a,2);days(G,2);assert.equal(G.world.prov[2].controller,1);});
test('bitwa toczy się przed wejściem; wsparcie nie okupuje',async()=>{const G=await game();war(G);const a=api.spawnArmy(G,1,2,12000,true);const d=api.spawnArmy(G,2,3,1000,true);api.playerIssueOrder(G,[a],3,{supportAttack:true});days(G,1);assert.equal(a.prov,2);assert.equal(G.world.prov[3].controller,2);assert(a.fighting);days(G,30);assert.equal(a.prov,2);assert.equal(G.world.prov[3].controller,2);assert(!a.path);});
test('zwycięski atak wkracza i zajmuje po pokonaniu obrońcy',async()=>{const G=await game();war(G);const a=api.spawnArmy(G,1,2,18000,true);api.spawnArmy(G,2,3,400,true);api.playerMoveArmy(G,a,3);days(G,1);assert.equal(a.prov,2);assert(G.battles.size);days(G,28);assert.equal(a.prov,3);assert.equal(G.world.prov[3].controller,1);});
test('neutralna armia w prowincji nie blokuje wykrycia wrogów',async()=>{const G=await game();war(G);api.spawnArmy(G,3,3,3000,true);const a=api.spawnArmy(G,1,3,3000,true);api.spawnArmy(G,2,3,3000,true);days(G,1);assert(a.fighting);assert.equal(G.battles.size,1);});
test('kolejka ma punkty docelowe i nie wraca do starego końca',async()=>{const G=await game();war(G);const a=api.spawnArmy(G,1,1,6000,true);api.playerMoveArmy(G,a,2);assert(api.playerIssueOrder(G,[a],3,{queue:true}));assert(api.playerIssueOrder(G,[a],4,{queue:true}));assert.deepEqual(a.orderQueue,[3,4]);days(G,6);assert.equal(a.prov,4);assert.equal(a.path,null);assert.equal(G.world.prov[3].controller,1);});
test('utrata prawa przejścia przerywa wydany rozkaz',async()=>{const G=await game();G.access.set('1>2',20);const a=api.spawnArmy(G,1,2,2000,true);assert(api.playerMoveArmy(G,a,3));G.access.clear();days(G,1);assert.equal(a.prov,2);assert.equal(a.path,null);});
test('morale wraca po bitwie i rezerwy uzupełniają straty',async()=>{const G=await game();const a=api.spawnArmy(G,1,1,3000,true);a.size=2000;a.morale=.3;days(G,10);assert(a.morale>.5);assert(a.size>2000);});
test('biały pokój cofa okupację i raster, daje rozejm',async()=>{const G=await game(),w=war(G);api.spawnArmy(G,1,3,5000,true);days(G,1);api.makePeace(G,w,{});assert.equal(G.world.prov[3].controller,2);assert(G.world.prov[3].cells.every(i=>G.ctrl[i]===2));assert.equal(G.wars.length,0);assert.equal(api.declareWar(G,1,2),false);});
test('pełna okupacja daje warunki do przejęcia kraju, odświeża stolicę',async()=>{const G=await game(),w=war(G);for(const id of [3,4]){G.world.prov[id].controller=1;}syncFrontKnights(G);assert.equal(api.warScore(G,w,1),100);const r=api.playerPeaceDemand(G,w,[{pid:3,to:1},{pid:4,to:1}],0);assert(r.ok);assert.equal(G.world.countries[2].alive,false);assert.equal(G.world.countries[2].capital,0);assert(G.world.countries[1].provs.includes(3));});
test('traktat odrzuca obce identyfikatory i ujemne reparacje',async()=>{const G=await game(),w=war(G);assert.equal(api.playerPeaceDemand(G,w,[{pid:999}],0).ok,false);assert.equal(api.playerPeaceDemand(G,w,[],-1).ok,false);assert.equal(G.wars.length,1);});
test('dyplomacja przyjmuje prawidłowe argumenty i odrzuca błędne',async()=>{const G=await game(),old=getRel(G,1,2);assert.equal(diploAction(G,1,2,'improve').ok,true);assert(getRel(G,1,2)>old);assert.equal(diploAction(G,'improve',2).ok,false);});
test('podział i scalanie zachowują stan docelowy i ludzi',async()=>{const G=await game(),a=api.spawnArmy(G,1,1,3000,true);a.size=2000;const b=api.playerSplitArmy(G,a);assert(b);assert.equal(a.size+b.size,2000);assert.equal(a.maxSize+b.maxSize,3000);assert(api.playerUndoSplit(G,a,b));assert.equal(a.maxSize,3000);});
test('rekrutacja w wybranej prowincji, walidacja ilości',async()=>{const G=await game();assert(api.playerRecruit(G,3000,2));assert.equal(G.armies[0].prov,2);assert.equal(api.playerRecruit(G,-500,1),false);assert.equal(api.playerRecruit(G,3000,3),false);});
test('zaopatrzenie nie przechodzi przez neutralną granicę',async()=>{const G=await game();war(G);G.world.prov[3].controller=1;G.world.prov[2].controller=2;syncFrontKnights(G);const a=api.spawnArmy(G,1,3,3000,true);days(G,1);assert(a.encircled);G.world.prov[2].controller=1;days(G,1);assert(!a.encircled);});
test('cała mapa: komórki, połączenia i kontrola po rocznej symulacji',async()=>{
 const G=await game(source),{world:W}=G;assert.equal(W.grid.length,W.W*W.H);assert.equal(W.components,1,'wszystkie wyspy mają przeprawy');
 let disconnected=0;
 for(const p of W.prov)if(p){
  assert(p.cells.length>0);assert.equal(W.grid[p.ay*W.W+p.ax],p.id);
  const found=new Set([p.cells[0]]),q=[p.cells[0]];
  for(let h=0;h<q.length;h++){const i=q[h],x=i%W.W;for(const k of [x?i-1:-1,x<W.W-1?i+1:-1,i-W.W,i+W.W])if(k>=0&&k<W.grid.length&&W.grid[k]===p.id&&!found.has(k)){found.add(k);q.push(k);}}
  if(found.size!==p.cells.length)disconnected++;
  for(const l of p.links){assert(W.prov[l.to]);assert(Number.isFinite(l.days));assert(W.prov[l.to].links.some(r=>r.to===p.id));}
 }
 assert.equal(disconnected,0,'prowincje muszą mieć spójny obszar');
 const pol=W.countries.find(c=>c?.name==='Poland'),enemy=W.countries.find(c=>c?.name==='Teutonic Order');
 G.player=pol.id;for(const c of W.countries)if(c)c.ai=c.id!==pol.id;
 api.declareWar(G,pol.id,enemy.id);for(const c of [pol,enemy])api.spawnArmy(G,c.id,c.capital,6000,true);
 days(G,365);
 for(const a of G.armies){assert(Number.isFinite(a.size));assert(a.size>0);assert(a.morale>=0&&a.morale<=1);assert(W.prov[a.prov]);}
 for(const p of W.prov)if(p)assert(p.cells.every(i=>G.ctrl[i]===p.controller));
 console.log('AUDYT MAPY:',W.prov.length-1,'prowincji;',W.countries.length-1,'państw;',disconnected,'rozłącznych prowincji');
});


test('marsz przez niebronione prowincje zajmuje je po drodze (jak HOI4)',async()=>{const G=await game();war(G);const a=api.spawnArmy(G,1,2,4000,true);assert(api.playerMoveArmy(G,a,4));days(G,12);assert.equal(G.world.prov[3].controller,1);assert.equal(G.world.prov[4].controller,1);});

test('po załadowaniu mapy żaden kraj nie ma eksklaw',async()=>{const G=await game(structuredClone(source));for(const c of G.world.countries){if(!c||!c.provs.length)continue;const own=new Set(c.provs),seen=new Set([c.provs[0]]),st=[c.provs[0]];while(st.length){const x=st.pop();for(const l of G.world.prov[x].links)if(own.has(l.to)&&!seen.has(l.to)){seen.add(l.to);st.push(l.to);}}assert.equal(seen.size,own.size,c.plName);assert(own.has(c.capital),c.plName+' stolica');}});

test('budynki: kolejka budowy, efekty, wybór liczby rekrutów',async()=>{
  const G=await game();
  const me=G.world.countries[G.player];
  const pid=me.provs.find(q=>G.world.prov[q].controller===G.player);
  me.gold=50000; me.manpower=50000;
  assert(api.playerBuild(G,pid,'farm'));
  assert.equal(api.playerBuild(G,pid,'farm'),false);
  days(G,25);
  assert.equal(G.world.prov[pid].bld.farm,1);
  G.world.prov[pid].bld.armory=3;
  const q=api.recruitQuote(G,1000,pid);
  assert(Math.abs(q.gold-20)<0.01,'zbrojownia 3 = -0,03 zł/człowieka');
  assert.equal(api.recruitMaxSize(G,pid)%100,0);
  assert(!api.playerRecruit(G,50,pid));
  assert(api.playerRecruit(G,500,pid));
  assert.equal(G.armies.at(-1).recruitDays,40);
  G.world.prov[pid].bld.camp=2;
  assert(api.playerRecruit(G,500,pid));
  assert.equal(G.armies.at(-1).recruitDays,40);
});

test('technologia, punkty ruchu, Twierdza tylko z budowy',async()=>{
  const G=await game();
  const me=G.world.countries[G.player];
  const pid=me.provs.find(q=>G.world.prov[q].controller===G.player);
  me.gold=500000;
  me.tech=0.1;
  assert.equal(api.buildInfo(G,pid,'zamek').ok,false,'tech za niska');
  me.tech=0.6;
  assert(api.playerBuild(G,pid,'zamek'));
  assert.equal(G.world.prov[pid].fort, G.world.prov[pid].fort);
  days(G,31);
  assert.equal(G.world.prov[pid].bld.zamek,1);
  me.mp=0.5;
  assert.equal(api.buildInfo(G,pid,'farm').ok,false,'za mało punktów ruchu');
});
