"""Arma out/index.html: estilos base, fuentes, datos del prototipo y el reproductor."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
B = json.load(open(os.path.join(OUT, 'build.json')))

fams = {}
for fam, w, it in B['fonts']:
    fams.setdefault(fam, set()).add(int(w))
q = '&'.join('family=' + f.replace(' ', '+') + ':wght@' + ';'.join(str(w) for w in sorted(ws)) for f, ws in sorted(fams.items()))
data = json.dumps(B, separators=(',', ':')).replace('</', '<\\/')
page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OVER Collab Hub · prototype</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="fonts/fonts.css">
<style>
html,body{{margin:0;height:100%;overflow:hidden;background:#F1F2F4}}
#app{{position:fixed;inset:0;overflow:hidden}}
#stage{{position:absolute;left:0;top:0;transform-origin:0 0}}
.f{{position:absolute;box-sizing:border-box;margin:0;pointer-events:auto}}.pe0{{pointer-events:none}}
.t{{white-space:normal;overflow-wrap:break-word;-webkit-font-smoothing:antialiased}}
img.f{{display:block;user-select:none;-webkit-user-drag:none}}
.scr{{scrollbar-width:none;overscroll-behavior:contain}}.scr::-webkit-scrollbar{{display:none}}
.ovl{{position:absolute;inset:0;z-index:50}}
.ovb{{position:absolute}}
#stage *{{-webkit-tap-highlight-color:transparent}}
</style></head>
<body><div id="app"><div id="stage"></div></div>
<script>window.HUB={data};</script>
<script src="player.js"></script>
</body></html>'''
open(os.path.join(OUT, 'index.html'), 'w').write(page)
import shutil; shutil.copy(os.path.join(HERE, 'player.js'), os.path.join(OUT, 'player.js'))
print('index.html', len(page) // 1024, 'KB')

# SVG repetidos (mismo ícono en muchas instancias): un solo archivo por contenido
import hashlib, re as _re, glob
idx = open(os.path.join(OUT, 'index.html')).read()
seen, ren = {}, {}
for p in sorted(glob.glob(os.path.join(OUT, 'a', '*.svg'))):
    h = hashlib.md5(open(p, 'rb').read()).hexdigest()[:12]
    new = 's' + h + '.svg'
    ren[os.path.basename(p)] = new
    np_ = os.path.join(OUT, 'a', new)
    if not os.path.exists(np_): os.rename(p, np_)
    elif p != np_: os.remove(p)
idx = _re.sub(r'a/(n[^"\\]+?\.svg)', lambda m: 'a/' + ren.get(m.group(1), m.group(1)), idx)
used = set(_re.findall(r'a/([\w.]+\.(?:svg|webp))', idx))
for p in glob.glob(os.path.join(OUT, 'a', '*')):
    if os.path.basename(p) not in used: os.remove(p)
open(os.path.join(OUT, 'index.html'), 'w').write(idx)
print('assets', len(used))
