// Naprawa topologii, bez pobierania danych ani zmiany właścicieli komórek lądu.
import fs from 'node:fs';
const file = new URL('../data/provinces.json', import.meta.url);
const j=JSON.parse(fs.readFileSync(file,'utf8')), {W,H}=j, N=W*H;
let grid=new Uint16Array(N), pos=0;
for(let k=0;k<j.rle.length;k+=2){grid.fill(j.rle[k],pos,pos+j.rle[k+1]);pos+=j.rle[k+1];}
if(pos!==N)throw Error('Nieprawidłowy RLE');
let P=[null,...j.provinces], counts=new Uint32Array(P.length);
for(const id of grid)counts[id]++;
const neighbors=i=>[i%W?i-1:-1,i%W<W-1?i+1:-1,i>=W?i-W:-1,i<N-W?i+W:-1].filter(x=>x>=0);
const seen=new Uint8Array(N), groups=new Map();
for(let i=0;i<N;i++)if(grid[i]&&!seen[i]){
 const id=grid[i],q=[i];seen[i]=1;
 for(let h=0;h<q.length;h++)for(const n of neighbors(q[h]))if(!seen[n]&&grid[n]===id){seen[n]=1;q.push(n);}
 if(!groups.has(id))groups.set(id,[]);groups.get(id).push(q);
}
const report={beforeProvinces:P.length-1,disconnectedBefore:[...groups.values()].filter(g=>g.length>1).length,mergedFragments:0,splitIslands:0,filledPinholes:0};
const original=new Uint16Array(grid), extra=[];
for(const [id,parts] of groups){
 parts.sort((a,b)=>b.length-a.length);
 for(let part=0;part<parts.length;part++){
  const cells=parts[part],contact=new Map();
  if(cells.length<48)for(const i of cells)for(const n of neighbors(i)){
   const o=grid[n];if(o&&o!==id&&P[o]?.c===P[id].c)contact.set(o,(contact.get(o)||0)+1);
  }
  const target=[...contact].sort((a,b)=>b[1]-a[1])[0]?.[0];
  if(target){for(const i of cells)grid[i]=target;report.mergedFragments++;}
  else if(part>0){
   const nid=P.length;P.push({...P[id],id:nid,name:P[id].name+' — wyspa '+part,fort:0});
   for(const i of cells)grid[i]=nid;report.splitIslands++;
  }
 }
}
// Tylko zamknięte 1–4-pikselowe dziury w obrębie jednego państwa.
seen.fill(0);
for(let i=0;i<N;i++)if(!grid[i]&&!seen[i]){
 const q=[i],border=new Map();seen[i]=1;let edge=false;
 for(let h=0;h<q.length;h++){
  const t=q[h];if(t<W||t>=N-W||t%W===0||t%W===W-1)edge=true;
  for(const n of neighbors(t))if(!grid[n]){if(!seen[n]){seen[n]=1;q.push(n);}}else border.set(grid[n],(border.get(grid[n])||0)+1);
 }
 const owners=new Set([...border.keys()].map(id=>P[id].c));
 if(!edge&&q.length<=4&&owners.size===1){const id=[...border].sort((a,b)=>b[1]-a[1])[0][0];for(const n of q)grid[n]=id;report.filledPinholes+=q.length;}
}
const cells=new Map();for(let i=0;i<N;i++)if(grid[i]){if(!cells.has(grid[i]))cells.set(grid[i],[]);cells.get(grid[i]).push(i);}
const ids=new Map([...cells.keys()].sort((a,b)=>a-b).map((id,n)=>[id,n+1]));
const result=[];
for(const [old,id] of ids){
 const c=cells.get(old), p=P[old], adj=new Set();let x=0,y=0,dev=0,coastal=false;
 for(const i of c){x+=i%W;y+=(i/W)|0;const origin=original[i];dev+=origin?P[origin].dev/counts[origin]:0;
  for(const n of neighbors(i)){if(!grid[n])coastal=true;else if(grid[n]!==old)adj.add(ids.get(grid[n]));}
 }
 result.push({...p,id,cx:+(x/c.length).toFixed(2),cy:+(y/c.length).toFixed(2),dev:Math.max(1,Math.round(dev)),coastal:coastal?1:0,adj:[...adj].sort((a,b)=>a-b)});
}
for(let i=0;i<N;i++)if(grid[i])grid[i]=ids.get(grid[i]);
j.provinces=result;j.rle=[];let v=grid[0],num=1;for(let i=1;i<N;i++){if(grid[i]===v)num++;else{j.rle.push(v,num);v=grid[i];num=1;}}j.rle.push(v,num);
// Stonowana paleta atlasu politycznego.
const colors={Poland:'#ae777c',Lithuania:'#a79b72',France:'#6589a0',England:'#a16e68','Holy Roman Empire':'#959b91',Hungary:'#b29b79',Ottomans:'#819879',Byzantium:'#a18aa9',Castile:'#b6a274',Aragon:'#b29462',Portugal:'#73958a',Novgorod:'#929878','Teutonic Order':'#b5b7ae','Kalmar Union':'#95a9b3',Scotland:'#a6a285',Venice:'#6f9b9a','Golden Horde':'#ad9771',Muscovy:'#8a9475'};
for(const c of j.countries){if(colors[c.name])c.color=colors[c.name];else{const h=c.color.slice(1),rgb=[0,2,4].map(k=>parseInt(h.slice(k,k+2),16));c.color='#'+rgb.map((v,i)=>Math.round(v*.48+[132,139,124][i]*.52).toString(16).padStart(2,'0')).join('');}}
report.afterProvinces=result.length;
fs.writeFileSync(file,JSON.stringify(j));fs.writeFileSync(new URL('../data/map-repair-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(report);
