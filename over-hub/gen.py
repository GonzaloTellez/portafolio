"""Figma -> HTML: convierte un frame de Figma (JSON de la API) en HTML/CSS posicionado.

Uso: python3 gen.py  (lee fig-final.json y hub/dest-nodes.json; escribe hub/out/)
"""
import json, os, math, re, sys, urllib.request, urllib.error, html, hashlib, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'out')
AS = os.path.join(OUT, 'a')
os.makedirs(AS, exist_ok=True)
KEY = 'dmoiKQGXpYT1p23S66Nd8e'  # copia editable (el original quedó con límite de API)

page = json.load(open(os.path.join(ROOT, 'fig-final-geo.json')))['nodes']['587:1943']['document']
dest = {k: v['document'] for k, v in json.load(open(os.path.join(HERE, 'dest-nodes.json')))['nodes'].items()}
fills = json.load(open(os.path.join(HERE, 'imagefills.json')))['meta']['images']

IDX = {}
PARENT = {}
def reg(n):
    IDX[n['id']] = n
    for c in n.get('children', []): PARENT[c['id']] = n; reg(c)
reg(page)
IDX_PAGE = set(IDX)
for n in dest.values():
    if n['id'] not in IDX: reg(n)

def api(url):
    ck = os.path.join(HERE, 'cache', hashlib.md5(url.encode()).hexdigest() + '.json')
    os.makedirs(os.path.dirname(ck), exist_ok=True)
    if os.path.exists(ck): return json.load(open(ck))
    for i in range(12):
        try:
            d = json.load(urllib.request.urlopen(url, timeout=180))
            json.dump(d, open(ck, 'w')); return d
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get('Retry-After') or 0) or min(300, 20 * (i + 1))
            if wait > 600: raise RuntimeError(f'rate limited {wait}s')
            print('retry', e.code, 'wait', wait, flush=True); time.sleep(wait)
        except Exception as e:
            print('retry', e, flush=True); time.sleep(10 * (i + 1))
    raise SystemExit('api failed ' + url)

def fetch(url, path):
    if os.path.exists(path): return
    for i in range(5):
        try:
            urllib.request.urlretrieve(url, path); return
        except Exception as e:
            print('retry dl', e); time.sleep(2 * (i + 1))

# ---------- clasificación de nodos ----------
VEC = {'VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'REGULAR_POLYGON'}

def vis(n): return n.get('visible', True) is not False

def has_img(n):
    return any(f.get('type') == 'IMAGE' and f.get('visible', True) is not False for f in (n.get('fills') or []))

def sub(n):
    yield n
    for c in n.get('children', []):
        if vis(c): yield from sub(c)

def raster_needed(n):
    """Grupos con máscara, rotaciones o vectores con imagen: se exportan como imagen."""
    # la máscara recorta a sus hermanos: se rasteriza solo el grupo que la contiene
    if any(c.get('isMask') and vis(c) for c in n.get('children', [])): return True
    if n['type'] in VEC and has_img(n): return True
    if abs(n.get('rotation', 0) or 0) > 0.01 and any(m['type'] != 'TEXT' for m in sub(n)) and n['type'] not in ('TEXT',):
        return not any(m['type'] == 'TEXT' for m in sub(n))
    return False

def svg_ok(n):
    """Subárbol solo de formas (sin texto ni imágenes) con al menos un vector -> un SVG."""
    anyvec = False
    for m in sub(n):
        if m['type'] == 'TEXT' or has_img(m) or m.get('isMask'): return False
        if m['type'] in VEC: anyvec = True
    return anyvec

# ---------- estilos ----------
def rgba(c, a=1.0):
    a = a * c.get('a', 1)
    r, g, b = (round(c[k] * 255) for k in 'rgb')
    return f'#{r:02x}{g:02x}{b:02x}' if a >= .999 else f'rgba({r},{g},{b},{a:.3f})'

def paint_css(p, n):
    t = p['type']; op = p.get('opacity', 1)
    if t == 'SOLID': return rgba(p['color'], op)
    if t.startswith('GRADIENT_LINEAR'):
        h = p['gradientHandlePositions']; (x0, y0), (x1, y1) = (h[0]['x'], h[0]['y']), (h[1]['x'], h[1]['y'])
        bb = n.get('absoluteBoundingBox') or {'width': 1, 'height': 1}
        dx, dy = (x1 - x0) * bb['width'], (y1 - y0) * bb['height']
        ang = math.degrees(math.atan2(dx, -dy))
        stops = ','.join(f"{rgba(s['color'], op)} {s['position']*100:.1f}%" for s in p['gradientStops'])
        return f'linear-gradient({ang:.1f}deg,{stops})'
    if t.startswith('GRADIENT_RADIAL'):
        stops = ','.join(f"{rgba(s['color'], op)} {s['position']*100:.1f}%" for s in p['gradientStops'])
        return f'radial-gradient({stops})'
    return None

IMGS = {}  # imageRef -> archivo local
def image_file(ref):
    if ref in IMGS: return IMGS[ref]
    url = fills.get(ref)
    if not url: return None
    raw = os.path.join(HERE, 'raw', ref)
    os.makedirs(os.path.dirname(raw), exist_ok=True)
    fetch(url, raw)
    from PIL import Image
    im = Image.open(raw)
    im.load()
    # tamaño máximo razonable para web
    mx = 4096  # resolución original de Figma (los fondos 360 se ven a más de 4000 px de ancho)
    if max(im.size) > mx:
        s = mx / max(im.size); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    name = hashlib.md5(ref.encode()).hexdigest()[:10] + '.webp'
    im.save(os.path.join(AS, name), 'WEBP', quality=90, method=6)
    IMGS[ref] = 'a/' + name
    return IMGS[ref]

def radius(n):
    if n.get('rectangleCornerRadii'):
        return ' '.join(f'{v:.1f}px' for v in n['rectangleCornerRadii'])
    if n.get('cornerRadius'): return f"{n['cornerRadius']:.1f}px"
    if n['type'] == 'ELLIPSE': return '50%'
    return None

def box_css(n):
    s = []
    bgs = []
    vis_p = [p for p in (n.get('fills') or []) if p.get('visible', True) is not False]
    if len(vis_p) == 1 and vis_p[0]['type'] == 'SOLID':
        # un solo color sólido: background-color, que sí se puede animar
        s.append('background-color:' + paint_css(vis_p[0], n))
        vis_p = []
    for p in reversed(vis_p):
        if p['type'] == 'IMAGE':
            f = image_file(p.get('imageRef'))
            if f:
                mode = p.get('scaleMode', 'FILL')
                size = {'FILL': 'cover', 'FIT': 'contain', 'STRETCH': '100% 100%'}.get(mode, 'cover')
                bgs.append(f'url({f}) center/{size} no-repeat')
        else:
            c = paint_css(p, n)
            if c: bgs.append(c if c.startswith(('linear', 'radial')) else f'linear-gradient({c},{c})')
    if bgs:
        # la primera capa CSS es la de arriba
        s.append('background:' + ','.join(reversed(bgs)))
    r = radius(n)
    if r: s.append(f'border-radius:{r}')
    st = [p for p in (n.get('strokes') or []) if p.get('visible', True) is not False and p['type'] == 'SOLID']
    iw = n.get('individualStrokeWeights')
    if st and iw:
        c = rgba(st[0]['color'], st[0].get('opacity', 1))
        for side in ('top', 'right', 'bottom', 'left'):
            if iw.get(side): s.append(f'border-{side}:{iw[side]}px solid {c}')
    elif st and n.get('strokeWeight'):
        w = n['strokeWeight']; c = rgba(st[0]['color'], st[0].get('opacity', 1))
        align = n.get('strokeAlign', 'INSIDE')
        if align == 'OUTSIDE': s.append(f'box-shadow:0 0 0 {w}px {c}')
        elif align == 'CENTER': s.append(f'outline:{w}px solid {c};outline-offset:-{w/2}px')
        else: s.append(f'outline:{w}px solid {c};outline-offset:-{w}px')
    sh = []
    for e in n.get('effects') or []:
        if e.get('visible') is False: continue
        if e['type'] == 'DROP_SHADOW' and not vis_p and n['type'] in ('GROUP', 'FRAME', 'INSTANCE', 'COMPONENT', 'BOOLEAN_OPERATION'):
            # sin relleno propio: la sombra la proyecta el contenido, no una caja
            o = e.get('offset', {'x': 0, 'y': 0})
            s.append(f"filter:drop-shadow({o['x']}px {o['y']}px {e.get('radius',0)/2:.1f}px {rgba(e['color'])})")
            continue
        if e['type'] in ('DROP_SHADOW', 'INNER_SHADOW'):
            o = e.get('offset', {'x': 0, 'y': 0})
            sh.append(f"{'inset ' if e['type']=='INNER_SHADOW' else ''}{o['x']}px {o['y']}px {e.get('radius',0)}px {e.get('spread',0)}px {rgba(e['color'])}")
        elif e['type'] == 'LAYER_BLUR': s.append(f"filter:blur({e['radius']/2:.1f}px)")
        elif e['type'] == 'BACKGROUND_BLUR': s.append(f"backdrop-filter:blur({e['radius']/2:.1f}px);-webkit-backdrop-filter:blur({e['radius']/2:.1f}px)")
    if sh: s.append('box-shadow:' + ','.join(sh))
    if n.get('opacity', 1) < 1: s.append(f"opacity:{n['opacity']:.3f}")
    return s

FONTS = set()
def text_css(st, n=None):
    s = []
    fam = st.get('fontFamily');
    if fam: FONTS.add((fam, st.get('fontWeight', 400), bool(st.get('italic')))); s.append(f"font-family:'{fam}',sans-serif")
    if st.get('fontWeight'): s.append(f"font-weight:{st['fontWeight']}")
    if st.get('fontSize'): s.append(f"font-size:{st['fontSize']:.2f}px")
    if st.get('italic'): s.append('font-style:italic')
    if st.get('letterSpacing'): s.append(f"letter-spacing:{st['letterSpacing']:.2f}px")
    if st.get('lineHeightPx') and st.get('lineHeightUnit') != 'INTRINSIC_%': s.append(f"line-height:{st['lineHeightPx']:.2f}px")
    tc = st.get('textCase')
    if tc == 'UPPER': s.append('text-transform:uppercase')
    elif tc == 'LOWER': s.append('text-transform:lowercase')
    elif tc == 'TITLE': s.append('text-transform:capitalize')
    td = st.get('textDecoration')
    if td == 'UNDERLINE': s.append('text-decoration:underline')
    elif td == 'STRIKETHROUGH': s.append('text-decoration:line-through')
    return s

def text_color(fl):
    for p in fl or []:
        if p.get('visible', True) is not False and p['type'] == 'SOLID': return rgba(p['color'], p.get('opacity', 1))
    return None

def text_html(n):
    chars = n.get('characters', '')
    ov = n.get('characterStyleOverrides') or []
    tab = n.get('styleOverrideTable') or {}
    base = n.get('style', {})
    def st_of(k):
        return tab.get(str(k)) if k and str(k) in tab else None
    paras, i = [], 0
    for line in chars.split('\n'):
        paras.append((i, line)); i += len(line) + 1
    out = []
    for start, line in paras:
        def lh_of(o):
            if o.get('lineHeightUnit') == 'PIXELS' and o.get('lineHeightPx'): return o['lineHeightPx']
            unit = o.get('lineHeightUnit') or base.get('lineHeightUnit')
            if unit == 'FONT_SIZE_%':
                pct = o.get('lineHeightPercentFontSize') or base.get('lineHeightPercentFontSize') or 120
                return pct / 100 * (o.get('fontSize') or base.get('fontSize') or 16)
            if unit == 'INTRINSIC_%': return (o.get('fontSize') or base.get('fontSize') or 16) * 1.2
            return o.get('lineHeightPx') or base.get('lineHeightPx')
        segs, cur, buf = [], None, ''
        for j, ch in enumerate(line):
            k = ov[start + j] if start + j < len(ov) else 0
            if k != cur and buf: segs.append((cur, buf)); buf = ''
            cur = k; buf += ch
        if buf: segs.append((cur, buf))
        lhs = [lh_of(st_of(k) or {}) for k, _ in segs] or [lh_of({})]
        lhs = [x for x in lhs if x] or [None]
        body = ''
        for (k, t), l in zip(segs, [lh_of(st_of(k) or {}) for k, _ in segs]):
            t = html.escape(t)
            o = st_of(k)
            css = [c for c in text_css(o) if not c.startswith('line-height')] if o else []
            if o:
                c = text_color(o.get('fills'))
                if c: css.append('color:' + c)
            if l: css.append(f'line-height:{l:.2f}px')
            body += f'<span style="{";".join(css)}">{t}</span>' if css else t
        m = min(x for x in lhs if x) if lhs[0] else None
        out.append(f'<p style="margin:0;line-height:{m:.2f}px">{body or "<br>"}</p>' if m else f'<p style="margin:0">{body or "<br>"}</p>')
    return ''.join(out)

# ---------- exportaciones por lote ----------
SVG_IDS, PNG_IDS = set(), set()
FINE_IDS = set()
LOCAL_SVG = {}
MISSING = []

def live_inter(n):
    """¿Algún descendiente (no el propio nodo) tiene interacciones con acciones reales?"""
    for c in n.get('children', []):
        for m in sub(c):
            for r in m.get('interactions') or []:
                if any(a for a in r.get('actions') or []): return True
    return False

MULTI = set()  # componentes que pertenecen a un set con varias variantes (se animan por partes)
def plan(n, root=True, fine=False):
    if not vis(n): return
    if n['type'] in ('INSTANCE', 'COMPONENT') and (n.get('componentId') in MULTI or n['id'] in MULTI): fine = True
    if not root and live_inter(n):
        for c in n.get('children', []): plan(c, False, fine)
        return
    if not root and n['type'] != 'TEXT' and svg_ok(n) and (not fine or n['type'] in VEC):
        SVG_IDS.add(n['id'])
        if fine and n['type'] in VEC: FINE_IDS.add(n['id'])
        return
    for c in n.get('children', []): plan(c, False, fine)

def export(ids, fmt, scale=2):
    got = {}
    ids = sorted(i for i in ids if not os.path.exists(os.path.join(AS, fname(i, fmt))))
    for k in range(0, len(ids), 80):
        chunk = ids[k:k + 80]
        q = ','.join(chunk)
        extra = '&svg_include_id=false&svg_simplify_stroke=true' if fmt == 'svg' else f'&scale={scale}'
        r = api(f'https://api.figma.com/v1/images/{KEY}?ids={urllib.parse.quote(q)}&format={fmt}{extra}')
        for i, u in (r.get('images') or {}).items():
            if not u: continue
            p = os.path.join(AS, fname(i, fmt))
            if fmt == 'png':
                tmp = p + '.png'; fetch(u, tmp)
                from PIL import Image
                Image.open(tmp).save(p, 'WEBP', quality=85, method=6); os.remove(tmp)
            else:
                fetch(u, p)
    return got

def fname(i, fmt):
    return 'n' + re.sub(r'[^0-9A-Za-z]+', '_', i) + ('.svg' if fmt == 'svg' else '.webp')

import urllib.parse

# ---------- render ----------
def bb(n):
    return n.get('absoluteBoundingBox') or {'x': 0, 'y': 0, 'width': 0, 'height': 0}

def rb(n):
    return n.get('absoluteRenderBounds') or bb(n)

LOCAL = [False]
def PARENT_OFF(n, ox, oy):
    P = PARENT.get(n['id'])
    if not P: return (0, 0)
    pb = bb(P); return (pb['x'] - ox, pb['y'] - oy)
def rotated(rt): return abs(rt[0][1]) > 1e-3 or rt[0][0] < 0 or rt[1][1] < 0

def center_tf(rt, w, h, pad=0):
    """left/top y transform con origen en el centro: así un cambio de giro se anima girando en su sitio."""
    a, b, c, d = rt[0][0], rt[1][0], rt[0][1], rt[1][1]
    det = a * d - b * c
    if det < 0: ang = math.degrees(math.atan2(-b, -a)); sx = -1
    else: ang = math.degrees(math.atan2(b, a)); sx = 1
    cx = rt[0][2] + a * w / 2 + c * h / 2; cy = rt[1][2] + b * w / 2 + d * h / 2
    W, H = w + 2 * pad, h + 2 * pad
    return cx - W / 2, cy - H / 2, W, H, f'transform-origin:50% 50%;transform:rotate({ang:.2f}deg) scale({sx},1)'

def render(n, ox, oy, root=False, extra_cls=''):
    mine = LOCAL[0]
    rt = n.get('relativeTransform')
    kl = mine or bool(rt and n.get('size') and rotated(rt) and n['id'] not in SVG_IDS and not root)
    LOCAL[0] = kl
    try: return _render(n, ox, oy, root, extra_cls, mine)
    finally: LOCAL[0] = mine

def _render(n, ox, oy, root, extra_cls, mine):
    if not vis(n): return ''
    b = bb(n)
    x, y, w, h = b['x'] - ox, b['y'] - oy, b['width'], b['height']
    attrs = f'data-id="{n["id"]}" data-n="{html.escape(n["name"][:40])}"'
    if n['type'] in ('INSTANCE', 'COMPONENT'): attrs += f' data-c="{n.get("componentId", n["id"])}"'
    cls = ('f ' + extra_cls).strip()
    if n['id'] in SVG_IDS:
        if (mine or n['id'] in FINE_IDS) and n.get('relativeTransform') and n.get('size'):
            fn = fname(n['id'] + '_l', 'svg')
            svg_for(n, fn, local=True)
            t = n['relativeTransform']; pad = LOCAL_PAD.get(n['id'], 0)
            lx, ly, W, H, tf = center_tf(t, n['size']['x'], n['size']['y'], pad)
            if not mine: lx += PARENT_OFF(n, ox, oy)[0]; ly += PARENT_OFF(n, ox, oy)[1]
            st = f"left:{lx:.2f}px;top:{ly:.2f}px;width:{W:.2f}px;height:{H:.2f}px;{tf}"
            op = f";opacity:{n['opacity']:.3f}" if n.get('opacity', 1) < 1 else ''
            return f'<img class="{cls}" {attrs} src="a/{fn}" alt="" style="{st}{op}" draggable="false">'
        fn = fname(n['id'], 'svg')
        r = LOCAL_SVG.get(n['id'])
        if not r:
            if n.get('fillGeometry') is not None or any('fillGeometry' in m for m in sub(n)):
                r = svg_for(n, fn)
            else:
                MISSING.append(n['id']); return ''
            LOCAL_SVG[n['id']] = r
        st = f"left:{r['x']-ox:.2f}px;top:{r['y']-oy:.2f}px;width:{r['width']:.2f}px;height:{r['height']:.2f}px"
        attrs += f' data-bx="{x:.2f}" data-by="{y:.2f}" data-pad="{b["x"]-r["x"]:.2f}"'
        op = f";opacity:{n['opacity']:.3f}" if n.get('opacity', 1) < 1 else ''
        sh = [e for m in [n] for e in (m.get('effects') or []) if e.get('visible', True) and e['type'] == 'DROP_SHADOW']
        if sh: op += ';filter:' + ' '.join(f"drop-shadow({e.get('offset',{}).get('x',0)}px {e.get('offset',{}).get('y',0)}px {e.get('radius',0)/2:.1f}px {rgba(e['color'])})" for e in sh)
        return f'<img class="{cls}" {attrs} src="a/{fn}" alt="" style="{st}{op}" draggable="false">'
    st = [f'left:{x:.2f}px', f'top:{y:.2f}px', f'width:{w:.2f}px', f'height:{h:.2f}px']
    rt = n.get('relativeTransform')
    if mine and rt and n.get('size'):
        # dentro de un padre girado: coordenadas locales de Figma
        lx, ly, W, H, tf = center_tf(rt, n['size']['x'], n['size']['y'])
        st = [f'left:{lx:.2f}px', f'top:{ly:.2f}px', f'width:{W:.2f}px', f'height:{H:.2f}px']
        if rotated(rt): st.append(tf)
    elif rt and n.get('size') and rotated(rt) and n['id'] not in SVG_IDS:
        P = PARENT.get(n['id'])
        if True:
            # coordenadas del padre: su bbox; el origen local del nodo viene de la matriz
            pb = bb(P) if P else {'x': ox, 'y': oy}
            px, py = (pb['x'] - ox, pb['y'] - oy) if P else (0, 0)
            compute_abs_for(n)
            NA = ABS.get(n['id'])
            if NA is not None:
                lx, ly = NA[0][2] - ox, NA[1][2] - oy
            else:
                lx, ly = px + rt[0][2], py + rt[1][2]
            M = [[rt[0][0], rt[0][1], lx], [rt[1][0], rt[1][1], ly]]
            cx_, cy_, W_, H_, tf = center_tf(M, n['size']['x'], n['size']['y'])
            st = [f'left:{cx_:.2f}px', f'top:{cy_:.2f}px', f'width:{W_:.2f}px', f'height:{H_:.2f}px', tf]
    if n['type'] == 'TEXT':
        s = n.get('style', {})
        st += text_css(s)
        c = text_color(n.get('fills'))
        if c: st.append('color:' + c)
        al = s.get('textAlignHorizontal', 'LEFT')
        if al != 'LEFT': st.append('text-align:' + {'CENTER': 'center', 'RIGHT': 'right', 'JUSTIFIED': 'justify'}[al])
        va = s.get('textAlignVertical', 'TOP')
        if va != 'TOP':
            st.append('display:flex;flex-direction:column;justify-content:' + {'CENTER': 'center', 'BOTTOM': 'flex-end'}[va])
            inner = f'<span>{text_html(n)}</span>'
        else:
            inner = text_html(n)
        lhp = s.get('lineHeightPx') or s.get('fontSize', 16) * 1.2
        if s.get('textAutoResize') == 'WIDTH_AND_HEIGHT' or ('\n' not in n.get('characters', '') and h < lhp * 1.6):
            st.append('white-space:nowrap')
        if n.get('opacity', 1) < 1: st.append(f"opacity:{n['opacity']:.3f}")
        return f'<div class="{cls} t" {attrs} style="{";".join(st)}">{inner}</div>'
    kids = n.get('children', [])
    if n['type'] in VEC and has_img(n):
        m = mask_css(n, n)
        st += [c for c in box_css(n) if not c.startswith(('outline', 'border-radius'))]
        if m: st.append(m)
        return f'<div class="{cls}" {attrs} style="{";".join(st)}"></div>'
    st += box_css(n)
    if root and n.get('overflowDirection') in ('HORIZONTAL_SCROLLING', 'VERTICAL_SCROLLING', 'HORIZONTAL_AND_VERTICAL_SCROLLING', 'BOTH_DIRECTIONS'):
        # pantalla con desplazamiento (entorno 360): la escena se mueve y lo marcado como FIXED queda en la vista
        vk = [c for c in kids if vis(c)]
        fixed = [c for c in vk if c.get('scrollBehavior') == 'FIXED']
        moving = [c for c in vk if c.get('scrollBehavior') != 'FIXED']
        xs = [bb(c)['x'] - b['x'] for c in moving] + [0]; ys = [bb(c)['y'] - b['y'] for c in moving] + [0]
        xe = [bb(c)['x'] - b['x'] + bb(c)['width'] for c in moving] + [w]; ye = [bb(c)['y'] - b['y'] + bb(c)['height'] for c in moving] + [h]
        hz = 'HORIZONTAL' in n['overflowDirection'] or n['overflowDirection'] == 'BOTH_DIRECTIONS'
        vt = 'VERTICAL' in n['overflowDirection'] or n['overflowDirection'] == 'BOTH_DIRECTIONS'
        mx, my = (min(xs) if hz else 0), (min(ys) if vt else 0)
        cw, ch = ((max(xe) - mx) if hz else w), ((max(ye) - my) if vt else h)
        if cw > w + 1 or ch > h + 1:
            def rc(c):
                r = render(c, b['x'] + mx, b['y'] + my)
                cb = bb(c)
                # panorámica equirectangular (2:1) que envuelve la escena: se marca para girar 360°
                if cb['height'] and abs(cb['width'] / cb['height'] - 2) < 0.06 and any(has_img(m) for m in sub(c)) and cb['width'] > w * 2:
                    pass  # sin giro de 360: los fondos no empalman, la vista llega a un tope
                return r
            inner = ''.join(rc(c) for c in moving)
            ov = f"overflow:{'auto' if hz else 'hidden'} {'auto' if vt else 'hidden'}"
            scroller = (f'<div class="f scr scr-root" data-sx="{-mx:.0f}" data-sy="{-my:.0f}" style="left:0;top:0;width:{w:.2f}px;height:{h:.2f}px;{ov}">'
                        f'<div class="f pe0" style="left:0;top:0;width:{cw:.2f}px;height:{ch:.2f}px">{inner}</div></div>')
            fx = ''.join(render(c, b['x'], b['y']) for c in fixed)
            return f'<div class="{cls}" {attrs} style="{";".join(st)};overflow:hidden">{scroller}{fx}</div>'
    mk = [c for c in kids if c.get('isMask') and vis(c)]
    if mk:
        # la máscara recorta a los hermanos que están por encima de ella
        i = kids.index(mk[0])
        m = mask_css(mk[0], n)
        inner = ''.join(render(c, b['x'], b['y']) for c in kids[:i])
        masked = ''.join(render(c, b['x'], b['y']) for c in kids[i + 1:])
        inner += f'<div class="f" style="left:0;top:0;width:{w:.2f}px;height:{h:.2f}px;{m}">{masked}</div>'
        return f'<div class="{cls}" {attrs} style="{";".join(st)}">{inner}</div>'
    scroll = n.get('overflowDirection') in ('VERTICAL_SCROLLING', 'BOTH_DIRECTIONS', 'HORIZONTAL_SCROLLING') and n.get('clipsContent')
    if n.get('clipsContent') and not scroll: st.append('overflow:hidden')
    if scroll:
        st.append({'VERTICAL_SCROLLING': 'overflow:hidden auto', 'HORIZONTAL_SCROLLING': 'overflow:auto hidden'}.get(n['overflowDirection'], 'overflow:auto'))
        cls += ' scr'
        nfix = n.get('numberOfFixedChildren', 0) or 0
        fixed = kids[len(kids) - nfix:] if nfix else []
        moving = kids[:len(kids) - nfix] if nfix else kids
        inner = ''.join(render(c, b['x'], b['y']) for c in moving)
        # alto del contenido
        bottom = max([bb(c)['y'] + bb(c)['height'] - b['y'] for c in moving if vis(c)] + [h])
        inner += f'<div style="position:absolute;left:0;top:{bottom:.0f}px;width:1px;height:1px"></div>'
        body = f'<div class="{cls}" {attrs} style="{";".join(st)}">{inner}</div>'
        if fixed:
            fx = ''.join(render(c, ox, oy) for c in fixed)
            body += fx
        return body
    lm = n.get('layoutMode')
    if lm in ('HORIZONTAL', 'VERTICAL') and n.get('layoutWrap') != 'WRAP':
        hz = lm == 'HORIZONTAL'
        jm = {'MIN': 'flex-start', 'CENTER': 'center', 'MAX': 'flex-end', 'SPACE_BETWEEN': 'space-between'}
        st += ['display:flex', 'flex-direction:' + ('row' if hz else 'column'),
               'justify-content:' + jm.get(n.get('primaryAxisAlignItems', 'MIN'), 'flex-start'),
               'align-items:' + {'MIN': 'flex-start', 'CENTER': 'center', 'MAX': 'flex-end', 'BASELINE': 'baseline'}.get(n.get('counterAxisAlignItems', 'MIN'), 'flex-start'),
               f"padding:{n.get('paddingTop',0)}px {n.get('paddingRight',0)}px {n.get('paddingBottom',0)}px {n.get('paddingLeft',0)}px"]
        if n.get('primaryAxisAlignItems') != 'SPACE_BETWEEN' and n.get('itemSpacing'): st.append(f"gap:{n['itemSpacing']:.2f}px")
        parts = []
        for c in kids:
            hc = render(c, b['x'], b['y'])
            if not hc: continue
            if c.get('layoutPositioning') == 'ABSOLUTE': parts.append(hc); continue
            cb = bb(c)
            grow = c.get('layoutGrow', 0) == 1 or c.get(('layoutSizingHorizontal' if hz else 'layoutSizingVertical')) == 'FILL'
            big = 'search' in c['name'].lower()  # la búsqueda cede espacio al expandirse XR; lo demás mantiene su tamaño
            fx = 'flex:1 1 0;min-width:0;min-height:0' if grow else ('flex:0 1 auto;min-width:0' if big else 'flex:none')
            if c.get('layoutAlign') == 'STRETCH': fx += ';align-self:stretch'
            m = re.search(r'data-pad="([\d.-]+)"', hc[:400])
            pad = float(m.group(1)) if m and hc.startswith('<img') else 0
            ox_, oy_ = -pad, -pad
            mt = re.search(r'transform:matrix\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),', hc[:600])
            if mt:
                # hija girada dentro del flujo: se corre para que su caja girada ocupe su lugar
                A_, B_, C_, D_ = map(float, mt.groups())
                wq = float(re.search(r'width:([\d.]+)px', hc[:600]).group(1)); hq = float(re.search(r'height:([\d.]+)px', hc[:600]).group(1))
                xs_ = [A_ * u + C_ * v for u, v in ((0, 0), (wq, 0), (0, hq), (wq, hq))]; ys_ = [B_ * u + D_ * v for u, v in ((0, 0), (wq, 0), (0, hq), (wq, hq))]
                ox_, oy_ = -min(xs_), -min(ys_)
            inj = f';position:relative;left:{ox_:.2f}px;top:{oy_:.2f}px;{fx}' + (f';margin:0 {-2*pad:.2f}px {-2*pad:.2f}px 0' if pad else '')
            i0 = hc.index('style="') + 7; i1 = hc.index('"', i0)
            parts.append(hc[:i1] + inj + hc[i1:])
        inner = ''.join(parts)
        return f'<div class="{cls}" {attrs} style="{";".join(st)}">{inner}</div>'
    inner = ''.join(render(c, b['x'], b['y']) for c in kids)
    # como en Figma, un marco sin relleno no atrapa clics: pasan a lo que está debajo
    if not any(x.startswith(('background', 'outline', 'border', 'box-shadow')) for x in st) and not n.get('interactions'):
        cls += ' pe0'
    return f'<div class="{cls}" {attrs} style="{";".join(st)}">{inner}</div>'

def build(frame_id, extra_ids=()):
    F = IDX[frame_id]
    plan(F)
    for i in extra_ids: plan(IDX[i])
    print('svg', len(SVG_IDS), 'png', len(PNG_IDS))
    export(SVG_IDS, 'svg'); export(PNG_IDS, 'png')
    b = bb(F)
    main = render(F, b['x'], b['y'], root=True)
    variants = {}
    for i in extra_ids:
        v = IDX[i]; vb = bb(v)
        variants[i] = render(v, vb['x'], vb['y'], root=True)
    return b, main, variants

if __name__ == '__main__':
    b, main, variants = build('587:1944', list(dest.keys()))
    json.dump({'w': b['width'], 'h': b['height'], 'main': main, 'variants': variants,
               'fonts': sorted(FONTS)}, open(os.path.join(OUT, 'build.json'), 'w'))
    print('fonts', sorted(FONTS))
    print('html bytes', len(main), 'variants', {k: len(v) for k, v in variants.items()})

# ================= SVG locales a partir de la geometría (sin exportar imágenes) =================
ABS = {}  # id -> matriz absoluta 3x3
def _M(rt): return [[rt[0][0], rt[0][1], rt[0][2]], [rt[1][0], rt[1][1], rt[1][2]], [0, 0, 1]]
def _mul(a, b): return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]

def compute_abs(root):
    b = bb(root)
    if 'relativeTransform' not in root: return
    # la raíz: su esquina (sin rotación) está en su bbox
    rt = root['relativeTransform']
    A = [[rt[0][0], rt[0][1], b['x']], [rt[1][0], rt[1][1], b['y']], [0, 0, 1]]
    if abs(rt[0][1]) > 1e-6 or rt[0][0] < 0:  # raíz rotada: se ancla por la esquina real
        s = root['size']; pts = [(0, 0), (s['x'], 0), (0, s['y']), (s['x'], s['y'])]
        xs = [rt[0][0] * x + rt[0][1] * y for x, y in pts]; ys = [rt[1][0] * x + rt[1][1] * y for x, y in pts]
        A[0][2] = b['x'] - min(xs); A[1][2] = b['y'] - min(ys)
    def w(n, A):
        ABS[n['id']] = A
        for c in n.get('children', []):
            if 'relativeTransform' in c: w(c, _mul(A, _M(c['relativeTransform'])))
    w(root, A)

def _paint_svg(p, defs, gid):
    op = p.get('opacity', 1)
    if p['type'] == 'SOLID':
        c = p['color']; return f"rgb({round(c['r']*255)},{round(c['g']*255)},{round(c['b']*255)})", op * c.get('a', 1)
    if p['type'] == 'GRADIENT_LINEAR':
        h = p['gradientHandlePositions']
        st = ''.join(f'<stop offset="{s["position"]:.4f}" stop-color="rgb({round(s["color"]["r"]*255)},{round(s["color"]["g"]*255)},{round(s["color"]["b"]*255)})" stop-opacity="{s["color"].get("a",1):.3f}"/>' for s in p['gradientStops'])
        defs.append(f'<linearGradient id="{gid}" x1="{h[0]["x"]:.4f}" y1="{h[0]["y"]:.4f}" x2="{h[1]["x"]:.4f}" y2="{h[1]["y"]:.4f}">{st}</linearGradient>')
        return f'url(#{gid})', op
    if p['type'] == 'GRADIENT_RADIAL' and p.get('gradientStops'):
        c = p['gradientStops'][0]['color']; return f"rgb({round(c['r']*255)},{round(c['g']*255)},{round(c['b']*255)})", op
    return None, 0

LOCAL_PAD = {}
def _inv(A):
    a,b,c,d,e,f=A[0][0],A[1][0],A[0][1],A[1][1],A[0][2],A[1][2]; det=a*d-b*c
    return [[d/det,-c/det,(c*f-d*e)/det],[-b/det,a/det,(b*e-a*f)/det],[0,0,1]]

def svg_for(root, fname_out, local=False):
    compute_abs_for(root)
    b = bb(root)
    pad = 0
    for m in sub(root):
        if m.get('strokes') and m.get('strokeWeight'): pad = max(pad, m['strokeWeight'])
    pad = math.ceil(pad) + 1
    X, Y, W, H = b['x'] - pad, b['y'] - pad, b['width'] + 2 * pad, b['height'] + 2 * pad
    base = None
    if local and ABS.get(root['id']) is not None:
        base = _inv(ABS[root['id']]); X, Y = -pad, -pad; W, H = root['size']['x'] + 2 * pad, root['size']['y'] + 2 * pad
        LOCAL_PAD[root['id']] = pad
    defs, body = [], []
    k = [0]
    def w(n, op):
        if not vis(n): return
        op = op * n.get('opacity', 1)
        A = ABS.get(n['id'])
        if A is not None and base is not None: A = _mul(base, A)
        if A is not None:
            mt = f'matrix({A[0][0]:.5f} {A[1][0]:.5f} {A[0][1]:.5f} {A[1][1]:.5f} {A[0][2]-X:.3f} {A[1][2]-Y:.3f})'
            clip = ''
            if n.get('strokeAlign') == 'INSIDE' and n.get('strokeGeometry') and n.get('fillGeometry'):
                # el trazo "por dentro": se recorta con la forma del propio nodo
                k[0] += 1; cid = f'c{k[0]}'
                defs.append(f'<clipPath id="{cid}">' + ''.join(f'<path transform="{mt}" d="{g["path"]}"/>' for g in n['fillGeometry']) + '</clipPath>')
                clip = f' clip-path="url(#{cid})"'
            smt = mt
            if n.get('strokeAlign') in ('INSIDE', 'OUTSIDE') and n.get('strokeGeometry') and not clip and n.get('size'):
                # sin forma para recortar: el trazo centrado se escala para quedar por dentro (o por fuera) del contorno
                sw = n.get('strokeWeight', 0); W0, H0 = n['size']['x'], n['size']['y']
                sg = -1 if n['strokeAlign'] == 'INSIDE' else 1
                sx = (W0 + sg * sw) / W0 if W0 > sw else 1; sy = (H0 + sg * sw) / H0 if H0 > sw else 1
                S = [[sx, 0, W0 / 2 * (1 - sx)], [0, sy, H0 / 2 * (1 - sy)], [0, 0, 1]]
                A2 = _mul(A, S)
                smt = f'matrix({A2[0][0]:.5f} {A2[1][0]:.5f} {A2[0][1]:.5f} {A2[1][1]:.5f} {A2[0][2]-X:.3f} {A2[1][2]-Y:.3f})'
            for gi, (geo, paints) in enumerate(((n.get('fillGeometry') or [], n.get('fills') or []), (n.get('strokeGeometry') or [], n.get('strokes') or []))):
                for p in paints:
                    if p.get('visible', True) is False: continue
                    k[0] += 1
                    col, po = _paint_svg(p, defs, f'g{k[0]}')
                    if not col: continue
                    for g in geo:
                        rule = 'evenodd' if g.get('windingRule') == 'EVENODD' else 'nonzero'
                        a = op * po
                        pth = f'<path transform="{smt if gi == 1 else mt}" d="{g["path"]}" fill="{col}" fill-rule="{rule}"' + (f' fill-opacity="{a:.3f}"' if a < .999 else '') + '/>'
                        # el recorte va en un grupo: así el clipPath usa las coordenadas del SVG, no las del trazo
                        body.append(f'<g{clip}>{pth}</g>' if gi == 1 and clip else pth)
        for c in n.get('children', []): w(c, op)
    w(root, 1 / max(root.get('opacity', 1), 1e-6) * root.get('opacity', 1))
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.2f}" height="{H:.2f}" viewBox="0 0 {W:.2f} {H:.2f}">' + (f'<defs>{"".join(defs)}</defs>' if defs else '') + ''.join(body) + '</svg>'
    open(os.path.join(AS, fname_out), 'w').write(svg)
    return {'x': X, 'y': Y, 'width': W, 'height': H}

ROOT_OF = {}
def compute_abs_for(n):
    r = ROOT_OF.get(n['id'])
    if r and r not in _DONE: compute_abs(IDX[r]); _DONE.add(r)
_DONE = set()

def mask_css(mask, container):
    """CSS mask con la forma de la máscara, en coordenadas del contenedor."""
    compute_abs_for(mask)
    A = ABS.get(mask['id']); cb = bb(container)
    if A is None: return ''
    mt = f'matrix({A[0][0]:.5f} {A[1][0]:.5f} {A[0][1]:.5f} {A[1][1]:.5f} {A[0][2]-cb["x"]:.3f} {A[1][2]-cb["y"]:.3f})'
    paths = ''.join(f'<path transform="{mt}" d="{g["path"]}" fill-rule="{"evenodd" if g.get("windingRule")=="EVENODD" else "nonzero"}"/>' for g in mask.get('fillGeometry') or [])
    if not paths: return ''
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{cb["width"]:.2f}" height="{cb["height"]:.2f}">{paths}</svg>'
    uri = 'data:image/svg+xml,' + urllib.parse.quote(svg)
    return f"-webkit-mask:url('{uri}') 0 0/100% 100% no-repeat;mask:url('{uri}') 0 0/100% 100% no-repeat"
