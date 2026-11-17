// Atlas operacyjny: relief terenu, kontrola prowincji, granice i liczniki jednostek.
import { TERRAIN } from './data.mjs';
import { getRel, hasNap, hasAccess, guarantees, truceLeft, isAlly } from './diplo.mjs';
import { atWar, sameSide, SPEEDS } from './game.mjs';

export const DIPLO_COLORS = {
  'Ty': [76, 140, 210],
  'Sojusznik': [72, 178, 108],
  'Pakt / dostęp': [140, 195, 165],
  'Neutralny': [188, 178, 152],
  'Chłodne': [214, 158, 82],
  'Wróg': [196, 62, 54],
};

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return [150, 150, 150];
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export function diploColor(G, cid) {
  const me = G.player;
  if (cid === me) return DIPLO_COLORS['Ty'];
  if (atWar(G, me, cid)) return DIPLO_COLORS['Wróg'];
  if (isAlly(G, me, cid) || guarantees(G, me, cid)) return DIPLO_COLORS['Sojusznik'];
  if (hasNap(G, me, cid) || hasAccess(G, me, cid) || truceLeft(G, me, cid) > 0) return DIPLO_COLORS['Pakt / dostęp'];
  const r = getRel(G, me, cid);
  if (r <= -25) return DIPLO_COLORS['Chłodne'];
  return DIPLO_COLORS['Neutralny'];
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function createRenderer(world) {
  const { W, H, prov } = world;
  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');

  const seaCv = document.createElement('canvas'); seaCv.width = W; seaCv.height = H;
  const polCv = document.createElement('canvas'); polCv.width = W; polCv.height = H;
  const borderCv = document.createElement('canvas'); borderCv.width = W; borderCv.height = H;
  const hlCv = document.createElement('canvas'); hlCv.width = W; hlCv.height = H;
  const peaceCv = document.createElement('canvas'); peaceCv.width = W; peaceCv.height = H;
  let lastPeaceVer = -1;

  const relief = buildRelief();
  buildSea(seaCv, world);
  let borders = null, provinceEdges = null, frontEdges = null;
  let countryLabelCache = null, labelVersion = -1;
  const unitRects = [];
  let armyOffsets = new Map();
  let lastVersion = -1, lastSel = -2, lastSelArmy = '', lastFrontVer = -1, lastMode = '';
  let polImg = null, palOwn = [], palOcc = [];
  const provShade = new Float32Array(prov.length), provTint = new Array(prov.length);

  function paintCell(G, d, i) {
    const v=world.grid[i],o=i*4;
    if (!v) { d[o+3]=0; return; }
    const p=prov[v],cid=p.controller,col=palOwn[cid] || [140,150,130];
    const x=i%W,y=(i/W)|0, height=relief.height[i];
    const terrain=R.mapMode==='terrain';
    const ground=p.terrain==='forest'?[80,103,76]:p.terrain==='marsh'?[112,130,104]:p.terrain==='mountain'?[152,151,132]:[137,153,119];
    const blend=terrain?0.18:0.80;
    const shade=relief.light[i];
    const grain=relief.grain[i];
    for(let k=0;k<3;k++) d[o+k]=clamp255((col[k]*blend+ground[k]*(1-blend))*shade+grain);
    if (height>0.77 && p.terrain==='mountain') for(let k=0;k<3;k++) d[o+k]=clamp255(d[o+k]*.65+212*.35);
    if(p.controller!==p.owner && (x+y)%12<2) for(let k=0;k<3;k++)d[o+k]=clamp255(d[o+k]*.78);
    if(p.encircled && (x-y+W)%10<2) for(let k=0;k<3;k++)d[o+k]=clamp255(d[o+k]*.68);
    d[o+3]=255;
  }

  function buildRelief() {
    const N=W*H, height=new Float32Array(N),light=new Float32Array(N),grain=new Float32Array(N);
    const hash=(x,y)=>{let n=Math.imul(x+17,374761393)^Math.imul(y+31,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
    const noise=(x,y,step)=>{
      x/=step;y/=step;const ix=Math.floor(x),iy=Math.floor(y);let a=x-ix,b=y-iy;a=a*a*(3-2*a);b=b*b*(3-2*b);
      return (hash(ix,iy)*(1-a)+hash(ix+1,iy)*a)*(1-b)+(hash(ix,iy+1)*(1-a)+hash(ix+1,iy+1)*a)*b;
    };
    const mult={plain:.12,forest:.19,marsh:.07,hills:.47,mountain:1};
    const amplitude=new Float32Array(N);for(let i=0;i<N;i++)amplitude[i]=world.grid[i]?mult[prov[world.grid[i]].terrain]:0.10;
    // Rozmycie wysokości oddziela relief od administracyjnych granic prowincji.
    for(let pass=0;pass<3;pass++){
      const tmp=new Float32Array(N),out=new Float32Array(N),r=7;
      for(let y=0;y<H;y++){let sum=0;for(let x=-r;x<=r;x++)sum+=amplitude[y*W+Math.max(0,Math.min(W-1,x))];for(let x=0;x<W;x++){tmp[y*W+x]=sum/(r*2+1);sum+=amplitude[y*W+Math.min(W-1,x+r+1)]-amplitude[y*W+Math.max(0,x-r)];}}
      for(let x=0;x<W;x++){let sum=0;for(let y=-r;y<=r;y++)sum+=tmp[Math.max(0,Math.min(H-1,y))*W+x];for(let y=0;y<H;y++){out[y*W+x]=sum/(r*2+1);sum+=tmp[Math.min(H-1,y+r+1)*W+x]-tmp[Math.max(0,y-r)*W+x];}}
      amplitude.set(out);
    }
    for(let i=0;i<N;i++){
      const x=i%W,y=(i/W)|0,p=prov[world.grid[i]];
      const n=noise(x,y,19)*.45+noise(x,y,7)*.35+noise(x,y,2.7)*.20;
      height[i]=amplitude[i]*(.15+.85*(1-Math.abs(n*2-1)));
      grain[i]=(hash(x,y)-.5)*5;
    }
    const softened=new Float32Array(N);
    for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;softened[i]=(height[i]*4+height[i-1]+height[i+1]+height[i-W]+height[i+W])/8;}
    for(let i=0;i<N;i++) {
      const x=i%W,y=(i/W)|0;
      const dx=softened[y*W+Math.max(0,x-1)]-softened[y*W+Math.min(W-1,x+1)];
      const dy=softened[Math.max(0,y-1)*W+x]-softened[Math.min(H-1,y+1)*W+x];
      light[i]=Math.max(.65,Math.min(1.3, .97+(dx+dy)*1.7));
    }
    return {height:softened,light,grain};
  }

  function selSignature() {
    const list = Array.isArray(R.selectedArmies) ? R.selectedArmies : (R.selectedArmy ? [R.selectedArmy] : []);
    return list.map(a => a ? `${a.id}:${(a.path || []).join(',')}:${(a.orderQueue || []).join(',')}` : '').join('|');
  }

  const R = {
    canvas, ctx, world, W, H,
    cam: { x: W / 2, y: H / 2, zoom: 1.4 },
    hover: 0, selected: 0, selectedArmy: null, selectedArmies: [], mapMode: 'political',
    canSeeArmy: null,
    armyAt(sx,sy) { return [...unitRects].reverse().find(r=>sx>=r.x && sx<=r.x+r.w && sy>=r.y && sy<=r.y+r.h)?.army || null; },
    unitRects,
    setMapMode(m) { R.mapMode = m; lastVersion = -1; },
    armyScreenPos(G, a) { return armyScreenPos(G, a); },
    buildPolitical(G) {
      const cctx = polCv.getContext('2d');
      if (!polImg) polImg = cctx.createImageData(W, H);
      const d = polImg.data;
      const grid = world.grid;
      const diplo = R.mapMode === 'diplo' && G.rel;
      const C = world.countries;
      palOwn = C.map(c => c ? (diplo ? diploColor(G, c.id) : hexToRgb(c.color)) : [0, 0, 0]);
      palOcc = palOwn.map(col => [
        clamp255(col[0] * 0.78 + 236 * 0.22),
        clamp255(col[1] * 0.78 + 226 * 0.22),
        clamp255(col[2] * 0.78 + 205 * 0.22),
      ]);
      for (let id = 1; id < prov.length; id++) {
        const p = prov[id];
        if (!p) continue;
        provShade[id] = 1;
        provTint[id] = [0, 0, 0];
      }
      for (let i = 0, n = grid.length; i < n; i++) paintCell(G, d, i);
      cctx.putImageData(polImg, 0, 0);
      G.dirty && (G.dirty.length = 0);
      buildBorders(G);
      lastVersion = G.version;
      lastFrontVer = G.frontVer ?? -1;
      lastMode = R.mapMode;
    },
    updateDirty(G) {
      if (!G.dirty || !G.dirty.length || !polImg) return;
      if (G.dirty.length > 250000) { R.buildPolitical(G); return; }
      const d = polImg.data;
      let minX = W, minY = H, maxX = 0, maxY = 0;
      for (const i of G.dirty) {
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      G.dirty.length = 0;
      minX = Math.max(0, minX - 2); minY = Math.max(0, minY - 2);
      maxX = Math.min(W - 1, maxX + 2); maxY = Math.min(H - 1, maxY + 2);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          paintCell(G, d, y * W + x);
        }
      }
      polCv.getContext('2d').putImageData(polImg, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1);
      lastFrontVer = G.frontVer ?? -1;
    },
    peace: null,
    setPeace(P) { R.peace = P; lastPeaceVer = -1; },
    buildPeace() {
      const P = R.peace, ctx2 = peaceCv.getContext('2d');
      ctx2.clearRect(0, 0, W, H);
      if (!P) return;
      const img = ctx2.createImageData(W, H), d = img.data, grid = world.grid;
      for (let i = 0, n = grid.length; i < n; i++) {
        const pid = grid[i];
        if (!pid) continue;
        const o = i * 4, x = i % W, y = (i / W) | 0;
        if (P.sel && P.sel.has(pid)) {
          d[o] = 225; d[o + 1] = 80; d[o + 2] = 80; d[o + 3] = ((x + y) % 6 < 2) ? 195 : 105;
        } else if (P.dem && P.dem.has(pid)) {
          if ((x + y) % 7 < 2) { d[o] = 20; d[o + 1] = 14; d[o + 2] = 6; d[o + 3] = 95; }
        } else {
          d[o] = 18; d[o + 1] = 14; d[o + 2] = 8; d[o + 3] = 150;
        }
      }
      ctx2.putImageData(img, 0, 0);
      lastPeaceVer = P.ver;
    },
    drawHighlight(G) {
      const hctx = hlCv.getContext('2d');
      hctx.clearRect(0, 0, W, H);
      if (R.selected) {
        const p = prov[R.selected];
        if (p && p.cells) {
          hctx.fillStyle = 'rgba(255,242,188,0.20)';
          for (const i of p.cells) hctx.fillRect(i % W, (i / W) | 0, 1, 1);
        }
      }
      const selList = Array.isArray(R.selectedArmies) && R.selectedArmies.length
        ? R.selectedArmies
        : (R.selectedArmy ? [R.selectedArmy] : []);
      for (const a of selList) {
        if (!a || a.dead) continue;
        const targets = [...(a.path || []), ...(a.orderQueue || [])];
        if (!targets.length) continue;
        hctx.fillStyle = a.supportAttack ? 'rgba(130, 210, 255, 0.5)' : 'rgba(114,212,114,0.20)';
        for (const pid of targets) {
          const p = prov[pid];
          if (p && p.cells) for (const i of p.cells) hctx.fillRect(i % W, (i / W) | 0, 1, 1);
        }
      }
      lastSel = R.selected;
      lastSelArmy = selSignature();
    },
    render(G) {
      const c = R.cam;
      fitCanvas();
      if (!G || !G.world) {
        ctx.save();
        ctx.fillStyle = '#243f50';
        ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        ctx.translate(canvas.clientWidth / 2, canvas.clientHeight / 2);
        ctx.scale(c.zoom, c.zoom);
        ctx.translate(-c.x, -c.y);
        ctx.drawImage(seaCv, 0, 0);
        ctx.restore();
        drawCompass();
        return;
      }
      if ((R.mapMode === 'diplo' && G.version !== lastVersion) || (G.frontVer ?? -1) !== lastFrontVer || R.mapMode !== lastMode) {
        R.buildPolitical(G);
      } else {
        R.updateDirty(G);
      }
      if (R.selected !== lastSel || selSignature() !== lastSelArmy) R.drawHighlight(G);
      ctx.save();
      ctx.fillStyle = '#243f50';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.translate(canvas.clientWidth / 2, canvas.clientHeight / 2);
      ctx.scale(c.zoom, c.zoom);
      ctx.translate(-c.x, -c.y);
      ctx.drawImage(seaCv, 0, 0);
      ctx.drawImage(polCv, 0, 0);
      drawBorders(G,c);
      drawSeaLinks(c);
      drawPlaces(G,c);
      ctx.drawImage(hlCv, 0, 0);
      if (R.peace) {
        if (R.peace.ver !== lastPeaceVer) R.buildPeace();
        ctx.drawImage(peaceCv, 0, 0);
      }
      drawLabels(G, c);
      ctx.restore();
      layoutArmies(G);
      drawMovePath(G, c);
      drawArmies(G, c);
      drawBattles(G, c);
      drawPeaceBadges();
      drawCompass();
    },
    screenToCell(sx, sy) {
      const c = R.cam;
      const x = (sx - canvas.clientWidth / 2) / c.zoom + c.x;
      const y = (sy - canvas.clientHeight / 2) / c.zoom + c.y;
      return [Math.floor(x), Math.floor(y)];
    },
    cellToScreen(x, y) {
      const c = R.cam;
      return [(x - c.x) * c.zoom + canvas.clientWidth / 2, (y - c.y) * c.zoom + canvas.clientHeight / 2];
    },
    provAt(sx, sy) {
      const [x, y] = R.screenToCell(sx, sy);
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      return world.grid[y * W + x];
    },
  };

  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function buildBorders(G) {
    borders=new Path2D();provinceEdges=new Path2D();frontEdges={friendly:new Path2D(),enemy:new Path2D()};
    const grid=world.grid;
    const edge=(id,other,x,y,vertical)=>{
      if(!id || id===other)return;
      const p=prov[id],q=prov[other];
      const national=!q || p.controller!==q.controller || p.owner!==q.owner;
      const path=national?borders:provinceEdges;
      path.moveTo(x,y);path.lineTo(x+(vertical?0:1),y+(vertical?1:0));
      if(q&&atWar(G,p.controller,q.controller)){
        const target=(p.controller===G.player||q.controller===G.player)?frontEdges.friendly:frontEdges.enemy;
        target.moveTo(x,y);target.lineTo(x+(vertical?0:1),y+(vertical?1:0));
      }
    };
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x,id=grid[i];
      if(id){edge(id,x<W-1?grid[i+1]:0,x+1,y,true);edge(id,y<H-1?grid[i+W]:0,x,y+1,false);
        if(!x||!grid[i-1])edge(id,0,x,y,true);
        if(!y||!grid[i-W])edge(id,0,x,y,false);
      }
    }
  }
  function drawBorders(G,c) {
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    if(c.zoom>1.3){ctx.strokeStyle='rgba(30,40,33,0.24)';ctx.lineWidth=.55/c.zoom;ctx.stroke(provinceEdges);}
    ctx.strokeStyle='rgba(215,219,190,0.45)';ctx.lineWidth=3/c.zoom;ctx.stroke(borders);
    ctx.strokeStyle='rgba(32,43,39,0.82)';ctx.lineWidth=1.15/c.zoom;ctx.stroke(borders);
    ctx.strokeStyle='rgba(17,27,22,0.7)';ctx.lineWidth=5/c.zoom;ctx.stroke(frontEdges.friendly);ctx.stroke(frontEdges.enemy);
    ctx.strokeStyle='#7cce71';ctx.lineWidth=2.5/c.zoom;ctx.stroke(frontEdges.friendly);
    ctx.strokeStyle='#d87566';ctx.lineWidth=2.5/c.zoom;ctx.stroke(frontEdges.enemy);
    ctx.restore();
  }
  function drawSeaLinks(c){
    const p=prov[R.selected];if(!p)return;
    ctx.save();ctx.strokeStyle='rgba(127,200,226,.8)';ctx.lineWidth=1.5/c.zoom;ctx.setLineDash([5/c.zoom,4/c.zoom]);
    for(const l of p.links)if(l.sea){const q=prov[l.to];ctx.beginPath();ctx.moveTo(p.ax,p.ay);ctx.lineTo(q.ax,q.ay);ctx.stroke();}
    ctx.restore();
  }
  function drawPlaces(G,c){
    if(c.zoom<1.4)return;
    ctx.save();
    for(const p of prov)if(p){
      const [sx,sy]=R.cellToScreen(p.ax,p.ay);if(sx<0||sy<0||sx>canvas.clientWidth||sy>canvas.clientHeight)continue;
      const capital=world.countries[p.owner].capital===p.id;
      if(capital){ctx.font=`${16/c.zoom}px Georgia`;ctx.textAlign='center';ctx.fillStyle='#f3e4b4';ctx.strokeStyle='#354238';ctx.lineWidth=2/c.zoom;ctx.strokeText('★',p.ax,p.ay);ctx.fillText('★',p.ax,p.ay);}
      else if(c.zoom>2.3&&!isGenericName(p.name)){ctx.fillStyle='#e1dfc4';ctx.strokeStyle='#3d4a40';ctx.lineWidth=1/c.zoom;ctx.beginPath();ctx.arc(p.ax,p.ay,2/c.zoom,0,Math.PI*2);ctx.fill();ctx.stroke();}
    }
    ctx.restore();
  }
  function buildSea(cv,world){
    const c=cv.getContext('2d'),img=c.createImageData(W,H),d=img.data;
    const distance=new Uint16Array(W*H).fill(4000);
    for(let i=0;i<distance.length;i++)if(world.grid[i])distance[i]=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(x)distance[i]=Math.min(distance[i],distance[i-1]+1);if(y)distance[i]=Math.min(distance[i],distance[i-W]+1);}
    for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;if(x<W-1)distance[i]=Math.min(distance[i],distance[i+1]+1);if(y<H-1)distance[i]=Math.min(distance[i],distance[i+W]+1);}
    for(let i=0;i<distance.length;i++){
      const x=i%W,y=(i/W)|0,shelf=Math.max(0,1-distance[i]/17),wave=Math.sin(x*.10+y*.18)*.7+relief.grain[i]*.25;
      d[i*4]=42+shelf*16+wave;d[i*4+1]=67+shelf*23+wave;d[i*4+2]=82+shelf*22+wave;d[i*4+3]=255;
    }
    c.putImageData(img,0,0);
    c.strokeStyle='rgba(177,200,211,.045)';c.lineWidth=.5;
    for(let x=0;x<W;x+=85){c.beginPath();c.moveTo(x,0);c.lineTo(x,H);c.stroke();}
    for(let y=0;y<H;y+=80){c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke();}
  }

  const isGenericName = n => /(?: [IVXLCDM]+(?: [A-Z])?| \d+| — (?:wyspa|okręg) \d+)$/.test(n);

  function drawLabels(G,c){
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
    if(c.zoom<2.25){
      if(labelVersion!==G.frontVer){
        countryLabelCache=[];
        for(const cn of world.countries)if(cn&&cn.provs.length){
          const ps=prov.filter(p=>p&&p.controller===cn.id);if(!ps.length)continue;
          let area=0,x=0,y=0;for(const p of ps){const a=p.cells.length;area+=a;x+=p.ax*a;y+=p.ay*a;}
          x/=area;y/=area;
          const anchor=ps.reduce((a,p)=>Math.hypot(p.ax-x,p.ay-y)<Math.hypot(a.ax-x,a.ay-y)?p:a,ps[0]);
          countryLabelCache.push({name:(cn.mapName||cn.plName).toUpperCase(),x:anchor.ax,y:anchor.ay,area});
        }
        countryLabelCache.sort((a,b)=>b.area-a.area);labelVersion=G.frontVer;
      }
      const used=[];
      for(const l of countryLabelCache){
        if(l.area<320 && c.zoom<1.4)continue;
        const [sx,sy]=R.cellToScreen(l.x,l.y);if(sx<-100||sy<-30||sx>canvas.clientWidth+100||sy>canvas.clientHeight+30)continue;
        const size=Math.min(19,Math.max(9,Math.sqrt(l.area)*.095*c.zoom));
        ctx.font=`600 ${size/c.zoom}px Georgia,serif`;
        const w=ctx.measureText(l.name).width*c.zoom;
        if(used.some(r=>Math.abs(r.x-sx)<(w+r.w)/2+5&&Math.abs(r.y-sy)<20))continue;
        ctx.lineWidth=2.5/c.zoom;ctx.strokeStyle='rgba(220,222,201,.5)';ctx.fillStyle='#26362f';ctx.strokeText(l.name,l.x,l.y);ctx.fillText(l.name,l.x,l.y);
        used.push({x:sx,y:sy,w});
      }
    }else{
      const placed=[];
      const ps=prov.filter(p=>p&&(!isGenericName(p.name)||c.zoom>4.5)).sort((a,b)=>b.dev-a.dev);
      ctx.font=`500 ${11/c.zoom}px "Segoe UI",sans-serif`;
      for(const p of ps){
        const [sx,sy]=R.cellToScreen(p.ax,p.ay);if(sx<-50||sy<-30||sx>canvas.clientWidth+50||sy>canvas.clientHeight+30)continue;
        if(p.cells.length<20&&c.zoom<5)continue;
        const name=p.name.length>26?p.name.slice(0,24)+'…':p.name,w=ctx.measureText(name).width*c.zoom,yy=sy+13;
        if(placed.some(r=>Math.abs(r.x-sx)<(r.w+w)/2+5&&Math.abs(r.y-yy)<15))continue;
        ctx.strokeStyle='rgba(35,48,42,.8)';ctx.lineWidth=2.4/c.zoom;ctx.fillStyle='#e7e8d3';
        ctx.strokeText(name,p.ax,p.ay+13/c.zoom);ctx.fillText(name,p.ax,p.ay+13/c.zoom);placed.push({x:sx,y:yy,w});
      }
    }
    ctx.restore();
  }

  function layoutArmies(G){
    armyOffsets=new Map();const groups=new Map();
    for(const a of G.armies)if(!a.dead&&(!R.canSeeArmy||R.canSeeArmy(a))){const key=`${a.prov}:${a.path?.[0]||0}:${a.fighting?1:0}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);}
    for(const list of groups.values())list.sort((a,b)=>a.country-b.country||a.id-b.id).forEach((a,i)=>{
      const cols=Math.min(3,list.length),row=(i/cols)|0,col=i%cols;
      armyOffsets.set(a.id,[(col-(cols-1)/2)*55,-24-row*31]);
    });
  }
  function armyScreenPos(G, a) {
    const p = world.prov[a.prov];
    if (!p) return null;
    if (a.path && a.path.length && a.moveTotal > 0 && !a.fighting && !a.supportAttack) {
      const next = world.prov[a.path[0]];
      if (next) {
        const subDay = (G && G.speed && G._acc)
          ? Math.min(1, (G._acc / SPEEDS[G.speed]) / Math.max(1, a.moveTotal))
          : 0;
        const frac = Math.max(0, Math.min(1, (a.moveTotal - a.moveLeft) / a.moveTotal + subDay));
        const ax = p.ax + (next.ax - p.ax) * frac;
        const ay = p.ay + (next.ay - p.ay) * frac;
        const pos=R.cellToScreen(ax,ay),off=armyOffsets.get(a.id)||[0,-24];return [pos[0]+off[0],pos[1]+off[1]];
      }
    }
    const pos=R.cellToScreen(p.ax,p.ay),off=armyOffsets.get(a.id)||[0,-24];return [pos[0]+off[0],pos[1]+off[1]];
  }

  function drawMovePath(G, c) {
    const selList = Array.isArray(R.selectedArmies) && R.selectedArmies.length
      ? R.selectedArmies
      : (R.selectedArmy ? [R.selectedArmy] : []);
    if (!selList.length) return;
    ctx.save();
    for (const a of selList) {
      if (!a || a.dead) continue;
      const steps = [...(a.path || []), ...(a.orderQueue || [])];
      if (!steps.length) continue;
      const startPos = armyScreenPos(G, a);
      const restPts = steps.map(pid => world.prov[pid]).filter(Boolean).map(p => R.cellToScreen(p.ax, p.ay));
      const pts = startPos ? [startPos, ...restPts] : restPts;
      if (pts.length < 2) continue;
      ctx.strokeStyle = a.supportAttack ? '#83c2de' : atWar(G,a.country,prov[steps[0]].controller) ? '#e08a74' : '#9adc85';
      ctx.lineWidth = 3;
      ctx.setLineDash(a.supportAttack ? [3, 4] : []);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
      const last = pts[pts.length - 1];
      const prev=pts[pts.length-2],ang=Math.atan2(last[1]-prev[1],last[0]-prev[0]);
      ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(last[0],last[1]);ctx.lineTo(last[0]-12*Math.cos(ang-.45),last[1]-12*Math.sin(ang-.45));ctx.lineTo(last[0]-12*Math.cos(ang+.45),last[1]-12*Math.sin(ang+.45));ctx.closePath();ctx.fill();
    }
    ctx.restore();
  }

  function drawArmies(G,c){
    unitRects.length=0;
    const selected=new Set(R.selectedArmies?.length?R.selectedArmies:[R.selectedArmy]);
    for(const a of G.armies){
      if(a.dead||(R.canSeeArmy&&!R.canSeeArmy(a)))continue;
      const pos=armyScreenPos(G,a);if(!pos)continue;
      const [sx,sy]=pos;if(sx<-70||sy<-50||sx>canvas.clientWidth+70||sy>canvas.clientHeight+50)continue;
      const enemy=atWar(G,G.player,a.country),own=a.country===G.player,sel=selected.has(a),w=50,h=27,x=sx-w/2,y=sy-h/2;
      const color=enemy?'#985e54':own?'#718366':'#768a92';
      ctx.save();ctx.shadowColor='rgba(10,18,18,.5)';ctx.shadowBlur=4;ctx.shadowOffsetY=2;
      const grad=ctx.createLinearGradient(x,y,x,y+h);grad.addColorStop(0,color);grad.addColorStop(1,enemy?'#513b36':own?'#3d4d39':'#3b4e56');
      ctx.fillStyle=grad;ctx.strokeStyle=sel?'#f4d57b':enemy?'#d5a295':'#bcc7b0';ctx.lineWidth=sel?2:1;
      roundRectPath(ctx,x,y,w,h,2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
      ctx.fillStyle=world.countries[a.country].color;ctx.fillRect(x+3,y+3,7,14);
      // Umowny znak piechoty, stały przy każdym powiększeniu.
      ctx.strokeStyle='#e4e8d4';ctx.lineWidth=.9;ctx.strokeRect(x+14,y+4,13,9);ctx.beginPath();ctx.moveTo(x+14,y+4);ctx.lineTo(x+27,y+13);ctx.moveTo(x+27,y+4);ctx.lineTo(x+14,y+13);ctx.stroke();
      ctx.fillStyle='#f2efdc';ctx.textAlign='right';ctx.textBaseline='middle';ctx.font='700 9px "Segoe UI",sans-serif';ctx.fillText(a.recruitDays?'◷':a.encircled?'!':String(a.id),x+w-4,y+8);
      ctx.textAlign='center';ctx.font='600 10px "Segoe UI",sans-serif';ctx.fillText(a.size>=1000?(a.size/1000).toFixed(1)+'k':String(Math.round(a.size)),x+w/2,y+18);
      ctx.fillStyle='#1c2825';ctx.fillRect(x+2,y+h-5,w-4,4);
      ctx.fillStyle='#8bc578';ctx.fillRect(x+2,y+h-5,(w-4)*Math.max(0,Math.min(1,a.morale)),2);
      ctx.fillStyle='#d6b768';ctx.fillRect(x+2,y+h-2,(w-4)*Math.max(0,Math.min(1,a.size/(a.maxSize||a.size))),1.5);
      if(a.fighting){ctx.fillStyle='#e9c792';ctx.fillRect(x+w-3,y-3,5,5);}
      ctx.restore();unitRects.push({x,y,w,h,army:a});
    }
  }
  function drawBattles(G,c){
    for(const B of G.battles.values()){
      const visible=G.armies.some(a=>!a.dead&&a.attackTarget===B.pid&&(!R.canSeeArmy||R.canSeeArmy(a)));if(!visible)continue;
      const p=prov[B.pid],[sx,sy]=R.cellToScreen(p.ax,p.ay);
      if(sx<-40||sy<-40||sx>canvas.clientWidth+40||sy>canvas.clientHeight+40)continue;
      const onFirst=sameSide(G,G.player,B.s1),pct=Math.round((onFirst?B.share1:1-B.share1)*100);
      ctx.save();ctx.fillStyle='#27322e';ctx.strokeStyle=pct>=50?'#8dc880':'#d48777';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(sx+25,sy+9,13,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.font='700 10px "Segoe UI",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#f2ecce';ctx.fillText(String(pct),sx+25,sy+9);ctx.restore();
    }
  }
  function drawPeaceBadges() {
    const P = R.peace;
    if (!P || !P.dem || !P.cost) return;
    ctx.save();
    ctx.font = '700 12px Satoshi, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    for (const pid of P.dem) {
      const p = world.prov[pid];
      if (!p) continue;
      const [sx, sy] = R.cellToScreen(p.ax, p.ay);
      if (sx < -40 || sy < -20 || sx > cw + 40 || sy > ch + 20) continue;
      const text = P.cost.get(pid) + ' ★', w = ctx.measureText(text).width + 14, on = P.sel && P.sel.has(pid);
      ctx.fillStyle = on ? '#d9b13a' : 'rgba(34,25,16,.9)';
      ctx.strokeStyle = on ? '#fff3c4' : '#c9a227';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(sx - w / 2, sy - 10, w, 20); ctx.fill(); ctx.stroke();
      ctx.fillStyle = on ? '#2a1d08' : '#e8c96a';
      ctx.fillText(text, sx, sy + 1);
    }
    ctx.restore();
  }

  function drawCompass() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const cx = w - 42, cy = h - 134, r = 20;
    ctx.save();
    ctx.fillStyle = 'rgba(31,46,46,0.9)';
    ctx.strokeStyle = 'rgba(185,198,173,.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#8b2518';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r + 4);
    ctx.lineTo(cx - 5, cy + 2);
    ctx.lineTo(cx + 5, cy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d6d8bf';
    ctx.font = '700 10px Zodiak, serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, cy + r - 4);
    ctx.restore();
  }

  return R;
}
