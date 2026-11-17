"""Conservative ownership corrections against the bundled historical geometry.
Development tool: requires numpy and shapely; the game has no dependencies.
Existing regional subdivisions are preserved. Not a claim of historical precision.
"""
import json,math,collections
from pathlib import Path
import numpy as np
from shapely.geometry import shape,Point
root=Path(__file__).resolve().parents[1];path=root/'data/provinces.json';j=json.loads(path.read_text());g=json.loads((root/'data/world_1400.mjs').read_text())
geoms=[(f['properties'].get('NAME'),shape(f['geometry'])) for f in g['features'] if f['properties'].get('NAME') and f.get('geometry')]
a=np.repeat(np.array(j['rle'][::2]),j['rle'][1::2]);W,H=j['W'],j['H'];y1=math.log(math.tan(math.pi/4+math.radians(j['LAT1'])/2));y0=math.log(math.tan(math.pi/4+math.radians(j['LAT0'])/2))
new=[('Timurid Empire','Imperium Timurydów','#8c9e89'),('Corsica','Korsyka','#9e9c7e'),('Aydin','Bejlik Aydin','#b09b79'),('Seljuk Caliphate','Sułtanat Seldżucki','#9b8d71'),('Siberians','Plemiona Syberii','#91a39f')]
for name,pl,col in new:
 if not any(c['name']==name for c in j['countries']):j['countries'].append({'id':len(j['countries'])+1,'name':name,'plName':pl,'color':col})
byname={c['name']:c['id'] for c in j['countries']};changes=[]
for p in j['provinces']:
 cells=np.where(a==p['id'])[0];ii=int(cells[len(cells)//2]);x,y=ii%W,ii//W
 lon=j['LON0']+(x+.5)*(j['LON1']-j['LON0'])/W;lat=math.degrees(2*math.atan(math.exp(y1-(y+.5)*(y1-y0)/H))-math.pi/2)
 names=[n for n,g in geoms if g.contains(Point(lon,lat))]
 if not names:continue
 source=names[0];current=j['countries'][p['c']-1]['name'];target=None
 mapping={'Kalmar Union':'Kalmar Union','Timurid Empire':'Timurid Empire','Corsica':'Corsica','Beylik of Aydin':'Aydin','Seljuk Caliphate':'Seljuk Caliphate','Siberians':'Siberians','Granada':'Granada','Portugal':'Portugal','Navarre':'Navarre','Teutonic Knights':'Teutonic Order','White Horde':'White Horde'}
 if source in mapping:target=mapping[source]
 elif current=='Holy Roman Empire' and source!='Holy Roman Empire':target={'France':'France','Byzantine Empire':'Byzantium','Blue Horde':'Golden Horde'}.get(source)
 elif source=='Kingdom of Hungary' and current in ['Poland','Moldavia','Bosnia','Serbia','Wallachia']:target='Hungary'
 elif source=='Poland-Lithuania' and current not in ['Poland','Lithuania']:target='Poland' if lon<23.8 and lat<54.5 else 'Lithuania'
 elif source=='France' and current=='Aragon':target='France'
 elif source=='Aragón':target='Aragon'
 elif source=='Castile':target='Castile'
 elif source=='Novgorod' and current in ['Golden Horde','Lithuania','Kalmar Union']:target='Novgorod'
 if target and byname[target]!=p['c']:
  changes.append({'province':p['id'],'name':p['name'],'from':current,'to':target,'source':source});p['c']=byname[target]
# Palette additions for the inherited political subdivisions.
extra={'Saxony':'#8b9d7a','Bavaria':'#9290a0','Bohemia':'#889d8c','Moldavia':'#96a47a','White Horde':'#aa8b8a','Bulgaria':'#a2a38d','Ireland':'#7a9a8a','Mamluks':'#ae9a80'}
for c in j['countries']:
 if c['name'] in extra:c['color']=extra[c['name']]
path.write_text(json.dumps(j,ensure_ascii=False,separators=(',',':')))
(root/'data/ownership-repair-report.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2))
print('Corrected',len(changes),'province assignments;',len(j['countries']),'countries.')
