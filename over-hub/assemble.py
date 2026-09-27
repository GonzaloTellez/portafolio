"""Arma out/index.html: estilos base, fuentes, datos del prototipo y el reproductor."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
B = json.load(open(os.path.join(OUT, 'build.json')))

fams = {}
for fam, w, it in B['fonts']:
    fams.setdefault(fam, set()).add(int(w))
q = '&'.join('family=' + f.replace(' ', '+') + ':wght@' + ';'.join(str(w) for w in sorted(ws)) for f, ws in sorted(fams.items()))
# la luna del hover de dim se usa como máscara CSS: va incrustada para que funcione también abriendo el archivo local
import re as _re0, base64 as _b64
_m = _re0.search(r'data-n="dim 2" src="([^"]+)"', B['variants'].get('587:4555', {}).get('html', ''))
if _m: B['altmoon'] = 'data:image/svg+xml;base64,' + _b64.b64encode(open(os.path.join(OUT, _m.group(1)), 'rb').read()).decode()
data = json.dumps(B, separators=(',', ':')).replace('</', '<\\/')
page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OVER Collab Hub · prototype</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="fonts/fonts.css">
<style>
html,body{{margin:0;height:100%;overflow:hidden;background:#141414}}
#app{{position:fixed;inset:0;overflow:hidden}}
#stage{{position:absolute;left:0;top:0;transform-origin:0 0;cursor:default;user-select:none;-webkit-user-select:none}}#stage .f{{cursor:inherit}}#stage .hot,#stage .hot *{{cursor:pointer}}
.f{{position:absolute;box-sizing:border-box;margin:0;pointer-events:auto}}.pe0{{pointer-events:none}}.gone,.gone *{{pointer-events:none!important}}
.t{{white-space:normal;overflow-wrap:break-word;-webkit-font-smoothing:antialiased}}
img.f{{display:block;user-select:none;-webkit-user-drag:none}}
.scr{{scrollbar-width:none;overscroll-behavior:contain}}.scr::-webkit-scrollbar{{display:none}}
.ovl{{position:absolute;inset:0;z-index:50}}
.ovb{{position:absolute}}
#stage *{{-webkit-tap-highlight-color:transparent}}.micon img{{transition:transform .45s cubic-bezier(.34,1.3,.64,1)!important}}.micon[data-n="light mode"]:hover img{{transform:rotate(90deg)!important}}.micon[data-n="dark"]:hover img{{transform:rotate(-165deg)!important}}.micon[data-n="dim"]:hover img[data-n="dim 1"]{{transform:translate(4.8px,.3px) scale(1.24)!important}}@media (prefers-reduced-motion:reduce){{.micon img{{transition:none!important}}}}#guide{{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(16,15,10,.45);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);transition:opacity .3s}}#guide.off{{opacity:0;pointer-events:none}}#guide .gc{{width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:'Work Sans',sans-serif;color:#100f0a;transform:translateY(0) scale(1);transition:transform .35s cubic-bezier(.34,1.56,.64,1)}}#guide.off .gc{{transform:translateY(12px) scale(.97)}}#guide .gh{{background:linear-gradient(90deg,#de5f60,#e9804f);color:#fff;padding:18px 22px;border-radius:14px 14px 0 0}}#guide .gh b{{display:block;font-size:20px;font-weight:700;letter-spacing:.01em}}#guide .gh span{{font-size:14px;opacity:.9}}#guide ol{{margin:0;padding:18px 22px 6px 22px;list-style:none;counter-reset:g}}#guide li{{counter-increment:g;display:flex;gap:12px;padding:8px 0;font-size:15px;line-height:1.4}}#guide li:before{{content:counter(g);flex:none;width:26px;height:26px;border-radius:50%;background:#4723a6;color:#fff;font-weight:600;font-size:13px;display:flex;align-items:center;justify-content:center}}#guide .gf{{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 22px 20px}}#guide .gf small{{color:#828796;font-size:13px}}#guide button{{border:0;border-radius:7px;background:#de5f60;color:#fff;font:700 15px 'Work Sans',sans-serif;padding:12px 20px;cursor:pointer}}#gqx{{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:90;height:34px;padding:0 16px;border-radius:17px;opacity:.85;border:0;background:#4723a6;color:#fff;font:700 18px 'Work Sans',sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}}
@media (max-height:640px){{#guide .gh{{padding:12px 18px}}#guide .gh b{{font-size:17px}}#guide ol{{padding:10px 18px 2px}}#guide li{{padding:4px 0;font-size:13px}}#guide li:before{{width:22px;height:22px;font-size:12px}}#guide .gf{{padding:8px 18px 14px}}#guide button{{padding:9px 16px;font-size:14px}}}}
.scr-root{{cursor:grab}}body.dragging,body.dragging *{{cursor:grabbing!important;user-select:none}}
</style></head>
<body><div id="app"><div id="stage"></div></div>
<div id="guide" role="dialog" aria-modal="true" aria-labelledby="gt"><div class="gc"><div class="gh"><b id="gt"></b><span id="gs"></span></div><ol id="gl"></ol><div class="gf"><small id="gn"></small><button type="button" id="gb"></button></div></div></div>
<script>(function(){{
var es=/[?&]lang=es/.test(location.search)||/^es/.test(document.referrer?'':'')&&false;
var T=es?{{t:'Bienvenido a OVER Collab Hub',s:'Una red para que creadores de realidad extendida encuentren equipo. Pruébala:',i:['Entra en AR o VR desde el botón XR y arrastra la vista para mirar a tu alrededor.','Contrae o despliega la barra lateral con la pestaña de su borde.','Cambia entre los modos claro, atenuado y oscuro desde el sol.','Abre «Recruit a team!» para armar un equipo, y la guía al entrar en VR.','Conecta otra red Web3 desde el selector de Polygon.','Toca la (i) de una publicación para ver sus detalles.'],n:'Vuelve a esta guía desde «Help?» en la barra lateral.',b:'Explorar',q:'Guía'}}
:{{t:'Welcome to OVER Collab Hub',s:'A network where extended reality creators find their team. Try it out:',i:['Step into AR or VR from the XR button and drag the view to look around.','Collapse or expand the sidebar from the tab on its edge.','Switch between light, dim and dark modes from the sun.','Open “Recruit a team!” to build a team, and the guide when entering VR.','Connect another Web3 network from the Polygon selector.','Tap the (i) on a post to see its details.'],n:'Come back to this guide from “Help?” in the sidebar.',b:'Explore',q:'Guide'}};
var g=document.getElementById('guide');
document.getElementById('gt').textContent=T.t;document.getElementById('gs').textContent=T.s;document.getElementById('gn').textContent=T.n;document.getElementById('gb').textContent=T.b;
document.documentElement.lang=es?'es':'en';
var l=document.getElementById('gl');T.i.forEach(function(x){{var li=document.createElement('li');li.textContent=x;l.appendChild(li)}});
function close(){{g.classList.add('off')}}function open(){{g.classList.remove('off');document.getElementById('gb').focus()}}
document.getElementById('gb').onclick=close;g.addEventListener('click',function(e){{if(e.target===g)close()}});
document.addEventListener('keydown',function(e){{if(e.key==='Escape')close()}});window.openGuide=open;if(/noguide/.test(location.search))close();
}})();</script>
<script>window.HUB={data};</script>
<script src="player.js"></script>
</body></html>'''
open(os.path.join(OUT, 'index.html'), 'w').write(page)
import shutil; shutil.copy(os.path.join(HERE, 'player.js'), os.path.join(OUT, 'player.js'))
print('index.html', len(page) // 1024, 'KB')

# SVG repetidos (mismo ícono en muchas instancias): un solo archivo por contenido.
# El resultado final va a out/dist (index, reproductor, fuentes y solo los archivos usados).
import hashlib, re as _re, glob, shutil
DIST = os.path.join(OUT, 'dist'); shutil.rmtree(DIST, ignore_errors=True); os.makedirs(os.path.join(DIST, 'a'))
idx = open(os.path.join(OUT, 'index.html')).read()
ren = {}
for p in sorted(glob.glob(os.path.join(OUT, 'a', '*.svg'))):
    ren[os.path.basename(p)] = 's' + hashlib.md5(open(p, 'rb').read()).hexdigest()[:12] + '.svg'
idx = _re.sub(r'a/(n[^"\\]+?\.svg)', lambda m: 'a/' + ren.get(m.group(1), m.group(1)), idx)
used = set(_re.findall(r'a/([\w.]+\.(?:svg|webp))', idx))
back = {v: k for k, v in ren.items()}
for u in used:
    src = os.path.join(OUT, 'a', back.get(u, u))
    if os.path.exists(src): shutil.copy(src, os.path.join(DIST, 'a', u))
open(os.path.join(DIST, 'index.html'), 'w').write(idx)
shutil.copy(os.path.join(OUT, 'player.js'), DIST); shutil.copytree(os.path.join(OUT, 'fonts'), os.path.join(DIST, 'fonts'))
print('assets', len(used))
