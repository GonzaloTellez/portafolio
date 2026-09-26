"""Recorre todo el prototipo desde el frame inicial (navegaciones, overlays y cambios de variante),
descarga lo que falte y genera out/build.json con el HTML de cada pantalla, variante y overlay,
más las interacciones de Figma para que el reproductor (player.js) las interprete."""
import json, os, urllib.parse
import gen
from gen import IDX, reg, api, KEY, render, plan, export, SVG_IDS, PNG_IDS, bb, vis, FONTS, OUT

START = '587:1944'
META = {}  # componentId -> {name, componentSetId}
for src in [json.load(open(os.path.join(gen.ROOT, 'fig-final-geo.json')))['nodes']['587:1943'],
            *json.load(open(os.path.join(gen.HERE, 'dest-nodes.json')))['nodes'].values()]:
    META.update(src.get('components', {}))

def parents():
    P = {}
    def w(n):
        for c in n.get('children', []): P[c['id']] = n['id']; w(c)
    for n in list(IDX.values()):
        if n['type'] in ('CANVAS', 'DOCUMENT') or n['id'] not in P: w(n)
    return P

def acts(a, out):
    if not a: return
    if a.get('destinationId'): out.append((a.get('navigation'), a['destinationId']))
    for b in a.get('conditionalBlocks', []) or []:
        for x in b.get('actions', []) or []: acts(x, out)

def sub(n):
    yield n
    for c in n.get('children', []): yield from sub(c)

GEO = set(gen.IDX_PAGE)
def fetch_nodes(ids):
    ids = sorted(set(i for i in ids if i not in GEO))
    for k in range(0, len(ids), 60):
        ch = ids[k:k + 60]
        try: r = api(f'https://api.figma.com/v1/files/{KEY}/nodes?ids={urllib.parse.quote(",".join(ch))}&geometry=paths')
        except Exception as e: print('sin acceso:', ch, e); continue
        for i, v in (r.get('nodes') or {}).items():
            if not v: print('no node', i); continue
            reg(v['document']); META.update(v.get('components', {})); GEO.add(i)

# nodos ya descargados antes (la API del plan gratuito tiene límite): se reutilizan
import glob
for f in sorted(glob.glob(os.path.join(gen.HERE, 'cache', '*.json'))):
    for i, v in (json.load(open(f)).get('nodes') or {}).items():
        if v and i not in GEO:
            reg(v['document']); META.update(v.get('components', {})); GEO.add(i)

screens, variants, overlays = [], [], []
seen = set()
queue = [('NAVIGATE', START)]
INTER, INST = {}, {}
while queue:
    fetch_nodes([d for _, d in queue])
    nxt = []
    for nav, d in queue:
        if d in seen or d not in IDX: continue
        seen.add(d)
        n = IDX[d]
        {'NAVIGATE': screens, 'SCROLL_TO': screens, 'SWAP': overlays, 'OVERLAY': overlays}.get(nav, variants).append(d)
        for m in sub(n):
            if not vis(m): continue
            if m.get('interactions'): INTER[m['id']] = m['interactions']
            if m['type'] == 'INSTANCE' and m.get('componentId'): INST[m['id']] = m['componentId']
            for r in m.get('interactions') or []:
                out = []
                for a in r.get('actions') or []: acts(a, out)
                nxt += [(nv or 'CHANGE_TO', x) for nv, x in out]
    queue = nxt
print('screens', len(screens), 'variants', len(variants), 'overlays', len(overlays))

# instancias originales a las que se puede volver con CHANGE_TO
for i, c in INST.items():
    if c not in IDX: pass

allroots = screens + variants + overlays
from collections import Counter
cnt = Counter(v.get('componentSetId') for v in META.values() if v.get('componentSetId'))
gen.MULTI.update(k for k, v in META.items() if cnt.get(v.get('componentSetId'), 0) > 1)
for r in allroots: plan(IDX[r])
print('svg', len(SVG_IDS), flush=True)
for r in allroots:
    for m in sub(IDX[r]): gen.ROOT_OF.setdefault(m['id'], r)

def mode_of(i):
    p = IDX.get(i)
    while p is not None:
        if p['type'] == 'SECTION':
            nm = p['name']; return 'dim' if 'Dim' in nm else 'dark' if 'Dark' in nm else 'light'
        p = gen.PARENT.get(p['id'])
    return 'light'

def pack(i, modes=False):
    n = IDX[i]; b = bb(n)
    out = {}
    if modes:
        base = render(n, b['x'], b['y'], root=True)
        for m in ('light', 'dim', 'dark'):
            gen.CUR_MODE[0] = m
            h = render(n, b['x'], b['y'], root=True)
            gen.CUR_MODE[0] = None
            if h.replace('_' + m, '') != base: out[m] = h
    return {'html': render(n, b['x'], b['y'], root=True), 'm': out, 'mode': mode_of(i), 'w': b['width'], 'h': b['height'], 'name': n['name'],
            'bg': n.get('overlayBackground'), 'pos': n.get('overlayPositionType'),
            'close': n.get('overlayBackgroundInteraction'), 'set': META.get(i, {}).get('componentSetId')}

build = {
    'start': START,
    'screens': {i: pack(i) for i in screens},
    'variants': {i: pack(i, True) for i in variants},
    'overlays': {i: pack(i) for i in overlays},
    'inter': INTER,
    'inst': INST,
    'sets': {k: v.get('componentSetId') for k, v in META.items()},
    'csize': {c: [bb(IDX[c])['width'], bb(IDX[c])['height']] for c in set(INST.values()) | set(variants) if c in IDX},
    'fonts': sorted(FONTS),
    'icon': {'light': '#000000', **{m: gen.VARMODES.get('VariableID:368:1386', {}).get(m, '#000000') for m in ('dim', 'dark')}},
}
json.dump(build, open(os.path.join(OUT, 'build.json'), 'w'))
print('missing svgs', len(gen.MISSING))
print('ok', {k: len(v) for k, v in build.items() if isinstance(v, dict)})
