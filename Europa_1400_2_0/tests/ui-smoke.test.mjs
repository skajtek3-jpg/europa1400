// Smoke test of UI event wiring in a minimal DOM adapter (not a browser layout test).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadWorld} from '../js/data.mjs';
import {createGame,declareWar} from '../js/game.mjs';
import {initUI} from '../js/ui.mjs';
import {getRel} from '../js/diplo.mjs';
class Element {
 constructor(tag='div',attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.dataset={};for(const [k,v] of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,a)=>a.toUpperCase())]=v;this.id=attrs.id;this.value=attrs.value||'';this.children=[];this.events={};this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){},contains(){return false;}};this.disabled='disabled' in attrs;}
 set innerHTML(v){this.html=v;this.children=[];for(const m of v.matchAll(/<([a-z][a-z0-9-]*)([^>]*)>/gi)){const attrs={};for(const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]||'';this.children.push(new Element(m[1],attrs));}}
 get innerHTML(){return this.html||'';} set textContent(v){this.text=v;} get textContent(){return this.text||'';}
 appendChild(e){this.children.push(e);} addEventListener(t,f){(this.events[t]??=[]).push(f);}
 all(){return this.children.flatMap(e=>[e,...e.all()]);}
 matches(s){if(s.startsWith('#'))return this.id===s.slice(1);if(s.startsWith('.'))return (this.attrs.class||'').split(' ').includes(s.slice(1));const a=s.match(/^\[([^\]]+)\]$/);return a?Object.hasOwn(this.attrs,a[1]):false;}
 querySelector(s){return this.all().find(e=>e.matches(s))||null;}querySelectorAll(s){return this.all().filter(e=>e.matches(s));}
 getBoundingClientRect(){return {height:64,width:1366,left:0,top:0};}focus(){}setSelectionRange(){}
 click(){const e={target:this};this.onclick?.(e);for(const f of this.events.click||[])f(e);}
 closest(){return this;}
}
test('UI: start, wybór prowincji, dyplomacja, rekrutacja, pokój i pomoc',async()=>{
 const document=new Element('document');document.innerHTML=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 document.getElementById=id=>document.querySelector('#'+id);document.createElement=tag=>new Element(tag);document.documentElement=new Element('html');document.activeElement=new Element('body');
 globalThis.document=document;globalThis.window={addEventListener(){},innerWidth:1366,innerHeight:900};
 globalThis.fetch=async()=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(new URL('../data/provinces.json',import.meta.url)))});
 const W=await loadWorld(),me=W.countries.find(c=>c?.name==='Poland'),enemy=W.countries.find(c=>c?.name==='Teutonic Order');const G=createGame(W,me.id);
 const R={canvas:document.getElementById('map'),selected:0,selectedArmies:[],selectedArmy:null,cam:{},mapMode:'political',drawHighlight(){},setMapMode(m){this.mapMode=m;},W:W.W,H:W.H};
 const UI=initUI(G,R,W);UI.refreshAll();assert(document.getElementById('tb-country').innerHTML.includes('Królestwo Polskie'));
 R.selected=me.capital;UI.refreshAll();{const si=document.getElementById('sidepanel').querySelector('.side-info');const h=si.innerHTML;UI.setProvTab('more');assert(document.getElementById('sidepanel').querySelector('.side-info').innerHTML.includes('data-build="farm"'),'budynki');UI.setProvTab('recruit');assert(document.getElementById('sidepanel').querySelector('.side-info').innerHTML.includes('recruit-size'),'suwak');UI.setProvTab(null);}const side=document.getElementById('sidepanel');const recruit=new Element('button',{id:'act-recruit'});const before=G.armies.length;for(const f of side.events.click)f({target:recruit});assert.equal(G.armies.length,before+1);assert.equal(G.armies.at(-1).prov,me.capital);
 R.selected=enemy.capital;UI.refreshAll();const old=getRel(G,me.id,enemy.id);const improve=new Element('button',{'data-aoh-act':'improve','data-aoh-target':String(enemy.id)});for(const f of side.events.click)f({target:improve});assert(getRel(G,me.id,enemy.id)>old);
 declareWar(G,me.id,enemy.id);W.prov[enemy.provs[0]].controller=me.id;UI.refreshAll();R.selected=enemy.provs[0];UI.refreshAll();{const h=document.getElementById('sidepanel').querySelector('.side-info').innerHTML;assert(h.includes('dr-box'));assert(h.includes('Twoje relacje'));assert(h.includes('W stanie wojny'));}document.getElementById('btn-peace').click();assert(document.getElementById('peace-send'));assert(document.getElementById('peace-white'));assert.equal(G.speed,0);
 const pzRow=document.getElementById('peace-ui').querySelector('[data-pz-prov]');assert(pzRow,'wiersz prowincji w rozmowach');assert(document.getElementById('pz-total').textContent.startsWith('0 /'));pzRow.click();assert(!document.getElementById('pz-total').textContent.startsWith('0 /'));
 document.getElementById('peace-white').click();assert.equal(G.wars.length,0);
 document.getElementById('btn-fulldiplo').click();{const h=document.getElementById('modal-root').innerHTML;for(const t of ['Przegląd','Relacje','Sojusze i pakty','Wasalizacje','Wojny','dr-box','fd-pick'])assert(h.includes(t),t);}for(const [tab,txt] of [['over','dr-row'],['pakt','Sojusznicy'],['vas','Wszystkie wasalizacje'],['war','wojna'],['rel','data-modal-country']]){UI.openFullDiplo(tab);assert(document.getElementById('modal-root').innerHTML.includes(txt),tab);}
 document.getElementById('btn-help').click();assert(document.getElementById('modal-root').innerHTML.includes('wsparcie'));
 document.getElementById('modal-x').click();document.getElementById('btn-mapmode').click();assert.equal(R.mapMode,'terrain');
});
