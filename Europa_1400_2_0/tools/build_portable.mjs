// Bez zależności: moduły ES w mapie importów, dane i CSS w jednym pliku.
import fs from 'node:fs';
const root=new URL('../',import.meta.url),imports={};
for(const name of fs.readdirSync(new URL('js/',root)).filter(n=>n.endsWith('.mjs'))){
 let src=fs.readFileSync(new URL('js/'+name,root),'utf8');
 src=src.replace(/(['"])\.\/([a-z]+)\.mjs\1/g,(_all,q,id)=>q+'europa/'+id+q);
 imports['europa/'+name.replace('.mjs','')]='data:text/javascript;base64,'+Buffer.from(src).toString('base64');
}
let html=fs.readFileSync(new URL('index.html',root),'utf8');
html=html.replace('<link rel="stylesheet" href="styles.css">','<style>'+fs.readFileSync(new URL('styles.css',root),'utf8')+'</style>');
html=html.replace('<script type="module" src="js/main.mjs"></script>', '<script id="world-data" type="application/json">'+fs.readFileSync(new URL('data/provinces.json',root),'utf8').replaceAll('<','\\u003c')+'</script>\n<script type="importmap">'+JSON.stringify({imports})+'</script>\n<script type="module">import "europa/main";</script>');
fs.writeFileSync(new URL('GRA.html',root),html);console.log('GRA.html: gotowa wersja offline.');
