/* Reproductor del prototipo de OVER Collab Hub.
   Interpreta las interacciones exportadas de Figma (HUB.inter): navegar, overlays, cambiar variante,
   variables booleanas y condiciones, con sus transiciones (Smart Animate, Dissolve, Move in) y curvas. */
(function(){
  var B=window.HUB, stage=document.getElementById('stage'), app=document.getElementById('app');
  var VARS={}, timers=[], cur=null, curEl=null, ovs=[];

  /* ---------- escala: el lienzo de 1920x1080 ocupa la ventana ---------- */
  function fit(){
    var s=B.screens[cur]||{w:1920,h:1080}, W=app.clientWidth, H=app.clientHeight, k=Math.min(W/s.w,H/s.h);
    stage.style.width=s.w+'px';stage.style.height=s.h+'px';
    stage.style.transform='translate('+((W-s.w*k)/2)+'px,'+((H-s.h*k)/2)+'px) scale('+k+')';
    SCALE=k;
  }
  var SCALE=1;
  /* pantallas con entorno: arranca en el encuadre del diseño */
  function home(root,dx,dy){dx=dx||0;dy=dy||0;[].forEach.call(root.querySelectorAll('.scr-root'),function(sc){
    var inner=sc.firstElementChild, pano=inner&&inner.querySelector(':scope>[data-pano]');
    if(pano&&!sc._pano){
      // 360°: la panorámica se repite a ambos lados y la vista se reubica sin que se note
      var W=parseFloat(pano.style.width), shift=document.createElement('div');
      shift.className='f pe0';shift.style.cssText='left:'+W+'px;top:0;width:'+inner.style.width+';height:'+inner.style.height;
      while(inner.firstChild)shift.appendChild(inner.firstChild);
      [-W,W].forEach(function(d){var c=pano.cloneNode(true);c.removeAttribute('data-pano');c.style.left=(parseFloat(pano.style.left)+d)+'px';shift.insertBefore(c,shift.firstChild)});
      inner.appendChild(shift);inner.style.width=(parseFloat(inner.style.width)+2*W)+'px';
      sc.setAttribute('data-sx',(+sc.getAttribute('data-sx')+W));
      var H0=+sc.getAttribute('data-sx');sc._pano=W;
      sc.addEventListener('scroll',function(){var x=sc.scrollLeft;if(x<H0-W/2)sc.scrollLeft=x+W;else if(x>H0+W/2)sc.scrollLeft=x-W;},{passive:true});
    }
    sc.scrollLeft=+sc.getAttribute('data-sx')+dx;sc.scrollTop=+sc.getAttribute('data-sy')+dy})}
  /* arrastrar para mirar alrededor (y para desplazar listas), como en el visor de Figma */
  var drag=null;
  function scroller(el,axis){
    while(el&&el!==stage){if(el.classList&&el.classList.contains('scr')){var can=axis==='x'?el.scrollWidth>el.clientWidth+1:el.scrollHeight>el.clientHeight+1;if(can)return el}el=el.parentElement}
    return null;
  }
  stage.addEventListener('pointerdown',function(e){if(e.pointerType!=='mouse'||e.button!==0)return;drag={x:e.clientX,y:e.clientY,t:e.target,moved:false,sx:scroller(e.target,'x'),sy:scroller(e.target,'y')}});
  window.addEventListener('pointermove',function(e){
    if(!drag)return;var dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.moved&&Math.abs(dx)+Math.abs(dy)<6)return;
    if(!drag.moved){drag.moved=true;document.body.classList.add('dragging')}
    if(drag.sx)drag.sx.scrollLeft-=dx/SCALE; if(drag.sy)drag.sy.scrollTop-=dy/SCALE;
    drag.x=e.clientX;drag.y=e.clientY;
  });
  window.addEventListener('pointerup',function(){if(drag&&drag.moved){setTimeout(function(){drag=null},0)}else drag=null;document.body.classList.remove('dragging')});
  stage.addEventListener('click',function(e){if(drag&&drag.moved){e.stopPropagation();e.preventDefault()}},true);
  window.addEventListener('resize',fit);

  /* ---------- curvas y duraciones de Figma ---------- */
  var EASE={LINEAR:'linear',EASE_IN:'cubic-bezier(.42,0,1,1)',EASE_OUT:'cubic-bezier(0,0,.58,1)',
    EASE_IN_AND_OUT:'cubic-bezier(.42,0,.58,1)',EASE_IN_BACK:'cubic-bezier(.36,0,.66,-.56)',
    EASE_OUT_BACK:'cubic-bezier(.34,1.56,.64,1)',EASE_IN_AND_OUT_BACK:'cubic-bezier(.68,-.6,.32,1.6)',
    GENTLE:'cubic-bezier(.25,.9,.35,1)',QUICK:'cubic-bezier(.2,.95,.25,1)',BOUNCY:'cubic-bezier(.2,1.5,.45,1)',SLOW:'cubic-bezier(.3,.9,.4,1)'};
  function tr(a){
    var t=a&&a.transition; if(!t||!t.type) return null;
    var e=t.easing||{}, ez=EASE[e.type]||'ease-out';
    var c=e.easingFunctionCubicBezier; if(c) ez='cubic-bezier('+c.x1+','+c.y1+','+c.x2+','+c.y2+')';
    return {type:t.type,dir:t.direction,ms:Math.max(1,Math.round((t.duration||0.3)*1000)),ease:ez};
  }
  function after(ms,fn){setTimeout(fn,ms+40)}
  function reflow(el){return el.offsetWidth}

  /* ---------- variables y expresiones ---------- */
  function val(v){
    if(!v) return undefined;
    if(v.type==='VARIABLE_ALIAS'){var id=(v.value&&v.value.id)||v.id;return !!VARS[id];}
    if(v.expressionFunction) return expr(v);
    if(v.type==='EXPRESSION'||(v.value&&v.value.expressionFunction)) return expr(v.value);
    return v.value;
  }
  function expr(e){
    var a=(e.expressionArguments||[]).map(val);
    switch(e.expressionFunction){
      case 'EQUALS': return a[0]===a[1];
      case 'NOT_EQUAL': return a[0]!==a[1];
      case 'AND': return a.every(Boolean);
      case 'OR': return a.some(Boolean);
      case 'NOT': return !a[0];
    }
    return false;
  }

  function html(s){var d=document.createElement('div');d.innerHTML=s;return d.firstElementChild;}

  /* ---------- transiciones ---------- */
  // capas por "ruta de nombres", como hace Smart Animate para emparejar
  function layers(root){
    var map={};
    (function walk(el,path){
      var seen={};
      [].forEach.call(el.children,function(c){
        var n=c.getAttribute('data-n'); if(n==null) { walk(c,path); return; }
        var k=path+'/'+n; seen[k]=(seen[k]||0)+1; var key=k+'#'+seen[k];
        map[key]=c; walk(c,key);
      });
    })(root,'');
    return map;
  }
  var PROPS=['left','top','width','height','opacity','background-color','color','border-radius','transform'];
  function snap(el){var s=el.style,o={};PROPS.forEach(function(p){o[p]=s.getPropertyValue(p)});return o}
  // valor actual en pantalla (sirve si la capa aún está a mitad de otra transición)
  function live(el){var s=el.style,c=getComputedStyle(el),o={};PROPS.forEach(function(p){o[p]=s.getPropertyValue(p)?c.getPropertyValue(p):''});return o}

  // hijas de auto layout -> posición absoluta en su lugar actual; devuelve cómo restaurarlas
  function absolutize(root){
    var els=[].filter.call(root.querySelectorAll('.f'),function(x){return x.style.position==='relative'}),m=els.map(function(x){return [x,x.offsetLeft,x.offsetTop,x.offsetWidth,x.offsetHeight,x.style.cssText]});
    m.forEach(function(q){var x=q[0];x.style.position='absolute';x.style.left=q[1]+'px';x.style.top=q[2]+'px';x.style.width=q[3]+'px';x.style.height=q[4]+'px';x.style.flex='none';x.style.margin='0'});
    return m.map(function(q){return [q[0],q[5]]});
  }
  /* reemplaza oldEl por newEl con la transición de Figma */
  function swap(oldEl,newEl,t,onDone,pre,opts){
    var par=oldEl.parentNode;oldEl._next=newEl;oldEl._leaving=true;oldEl.classList.add('gone');
    // dentro de un auto layout, el estado que sale deja de ocupar lugar: queda encima, en su misma posición
    if(oldEl.style.position==='relative'){var L=oldEl.offsetLeft,Tp=oldEl.offsetTop;oldEl.style.position='absolute';oldEl.style.left=L+'px';oldEl.style.top=Tp+'px';oldEl.style.margin='0';}
    if(!t||t.type==='INSTANT'||!t.ms){par.replaceChild(newEl,oldEl);pre&&pre();onDone&&onDone();return;}
    var T=t.ms+'ms '+t.ease;
    // la forma vieja se va en la segunda mitad, cuando la nueva ya casi cubre: sin bajón de opacidad
    var HALF=Math.round(t.ms/2)+'ms ease-in '+Math.round(t.ms/2)+'ms';
    if(t.type==='SMART_ANIMATE'){
      var A=layers(oldEl),Bm=layers(newEl), keep=[], ghosts=[];
      // el estado viejo queda detrás para desvanecer lo que desaparece
      par.insertBefore(newEl,oldEl.nextSibling);pre&&pre();
      oldEl.style.pointerEvents='none';
      // auto layout congelado: cada capa se interpola desde su posición real, sin que el flex la recoloque
      var saved=absolutize(newEl);absolutize(oldEl);
      var oldLive=live(oldEl);
      if(opts&&opts.over){
        // en un cambio de variante, lo que desaparece se desvanece por encima del fondo nuevo
        par.insertBefore(oldEl,newEl.nextSibling);
        if(getComputedStyle(oldEl).backgroundImage!=='none'){
          // un fondo degradado no se interpola: se funde por detrás
          var shell=oldEl.cloneNode(false);shell.removeAttribute('data-id');shell.removeAttribute('data-c');shell.classList.add('pe0');
          par.insertBefore(shell,newEl);ghosts.push(shell);shell.style.transition='opacity '+T;
          keep.push(function(){shell.style.opacity='0'});
        }
        oldEl.style.background='none';oldEl.style.boxShadow='none';oldEl.style.filter='none';oldEl.style.outline='none';oldEl.style.border='none';
      }
      var pairs=[];
      Object.keys(Bm).forEach(function(k){
        var n=Bm[k],o=A[k];
        if(o){pairs.push([o,n]);}
        else{var op=n.style.opacity||'1';n.style.opacity='0';keep.push(function(){n.style.transition='opacity '+T;n.style.opacity=op;});}
      });
      // raíz: de la caja vieja a la nueva
      pairs.unshift([oldEl,newEl]);
      // capas que solo cambian de escala (p. ej. la interfaz que se aleja en AR): se animan como un todo
      // con transform, para que textos e íconos escalen juntos; sus hijas no se interpolan por separado
      var flipped=[];
      pairs=pairs.filter(function(p){
        var o=p[0],n=p[1];
        if(flipped.some(function(f){return f.contains(n)}))return false;
        if(n===newEl||n.style.transform||o.style.transform)return true;
        var ow=parseFloat(o.style.width),oh=parseFloat(o.style.height),nw=parseFloat(n.style.width),nh=parseFloat(n.style.height);
        if(!(ow>4&&oh>4&&nw>4&&nh>4))return true;
        var kx=ow/nw,ky=oh/nh;
        if(Math.abs(kx-1)<0.03||Math.abs(kx-ky)>0.04||!n.children.length)return true;
        var ro=o.getBoundingClientRect(),rn=n.getBoundingClientRect();
        var dx=(ro.left-rn.left)/SCALE,dy=(ro.top-rn.top)/SCALE;
        if(o!==oldEl)o.style.visibility='hidden';
        n.style.transformOrigin='0 0';n.style.transform='translate('+dx+'px,'+dy+'px) scale('+kx+','+ky+')';
        keep.push(function(){n.style.transition='transform '+T;n.style.transform='';});
        // si además cambia de aspecto (color, ícono), la versión vieja acompaña el mismo movimiento y se desvanece
        var srcs=function(e){return e.querySelectorAll('img').length+'|'+e.querySelectorAll('*').length};
        if(o!==oldEl&&!sameLook(o,n)&&srcs(o)===srcs(n)&&n.style.backgroundColor&&getComputedStyle(o).backgroundColor!==n.style.backgroundColor){
          // mismas formas, otro color: el color se interpola durante el mismo movimiento
          var fc=getComputedStyle(o).backgroundColor,tc=n.style.backgroundColor;
          if(tc&&fc!==tc){n.style.backgroundColor=fc;keep.push(function(){n.style.transition='transform '+T+',background-color '+T;n.style.backgroundColor=tc;});}
        }else if(o!==oldEl&&!sameLook(o,n)){
          // la copia vieja va en el árbol nuevo, justo detrás de la capa nueva: respeta el orden de Figma
          var cp=o.cloneNode(true);cp.removeAttribute('data-id');cp.classList.add('pe0');cp.style.visibility='visible';cp.style.transformOrigin='0 0';
          cp.style.left=n.style.left;cp.style.top=n.style.top;cp.style.transform='translate('+dx+'px,'+dy+'px)';
          n.parentNode.insertBefore(cp,n);ghosts.push(cp);
          var op0=n.style.opacity||'1';n.style.opacity='0';
          keep.push(function(){cp.style.transition='transform '+T+',opacity '+HALF;cp.style.transform='translate(0px,0px) scale('+(1/kx)+','+(1/ky)+')';cp.style.opacity='0';
            n.style.transition='transform '+T+',opacity '+T;n.style.opacity=op0;});
        }
        flipped.push(n);return false;
      });
      keep=keep.filter(function(){return true});
      pairs.forEach(function(p){
        var o=p[0],n=p[1],from=o===oldEl?oldLive:live(o),to=snap(n);
        var morph=false,same=o.tagName===n.tagName&&(o.tagName!=='IMG'||o.getAttribute('src')===n.getAttribute('src'));
        if(!same&&o.tagName==='IMG'&&n.tagName==='IMG'){
          // misma figura a otra escala (p. ej. botones que se encogen): se anima el tamaño, sin fundido
          var ra=num(o.style.width)/Math.max(1,num(o.style.height)),rb=num(n.style.width)/Math.max(1,num(n.style.height));
          var rs=num(n.style.width)/Math.max(1,num(o.style.width));
          if(Math.abs(ra-rb)<0.1*rb&&Math.abs(rs-1)>0.05)morph=true;
          // misma forma y casi el mismo tamaño (solo cambia el tono): cambio directo, sin superponer dos versiones translúcidas
          else if(Math.abs(ra-rb)<0.05*rb&&Math.abs(rs-1)<=0.05)same=true;
        }
        if(same&&o!==oldEl) o.style.visibility='hidden';
        // si la capa venía invisible, su color no se interpola (evita destellos grises)
        var hid=parseFloat(from.opacity)===0;
        PROPS.forEach(function(pr){if(hid&&(pr==='background-color'||pr==='color'))return;if(from[pr]!==''&&from[pr]!==to[pr]&&!(p[1]===newEl&&(pr==='left'||pr==='top')))n.style.setProperty(pr,from[pr]);});
        if(!same&&o!==oldEl){
          // cambia la forma: la nueva aparece sobre una copia de la anterior (sin bajón de opacidad)
          var cp=o.cloneNode(true);cp.style.transition='';cp.style.visibility='';cp.removeAttribute('data-id');cp.classList.add('pe0');
          n.parentNode.insertBefore(cp,n);ghosts.push(cp);o.style.visibility='hidden';
          // la copia vieja acompaña el movimiento (giro, posición, tamaño) mientras se desvanece
          (function(cp,to){keep.push(function(){cp.style.transition=['left','top','width','height','transform'].map(function(x){return x+' '+T}).join(',')+',opacity '+HALF;
            ['left','top','width','height','transform'].forEach(function(pr){if(to[pr])cp.style.setProperty(pr,to[pr])});cp.style.opacity='0';});})(cp,to);
          var op=to.opacity||'1';n.style.opacity='0';keep.push(function(){n.style.opacity=op;});
        }else if(!same){var op2=to.opacity||'1';n.style.opacity='0';keep.push(function(){n.style.opacity=op2;});}
        keep.push(function(){n.style.transition=PROPS.map(function(x){return x+' '+T}).join(',');PROPS.forEach(function(pr){n.style.setProperty(pr,to[pr])});});
      });
      reflow(newEl);
      keep.forEach(function(f){f()});
      oldEl.style.transition='opacity '+T;oldEl.style.opacity='0';
      after(t.ms,function(){ghosts.forEach(function(g){g.remove()});oldEl.remove();Object.keys(Bm).forEach(function(k){Bm[k].style.transition=''});flipped.forEach(function(f){f.style.transformOrigin=''});saved.forEach(function(x){x[0].style.cssText=x[1]});newEl.style.transition='';onDone&&onDone();});
      return;
    }
    // DISSOLVE (y el resto): fundido cruzado
    par.insertBefore(newEl,oldEl.nextSibling);pre&&pre();
    var op=newEl.style.opacity||'1';
    newEl.style.opacity='0';oldEl.style.pointerEvents='none';reflow(newEl);
    newEl.style.transition='opacity '+T;newEl.style.opacity=op;
    after(t.ms,function(){oldEl.remove();newEl.style.transition='';onDone&&onDone();});
  }

  /* ---------- acciones ---------- */
  function run(a,el,ev){
    if(!a) return;
    if(a.type==='CONDITIONAL'){
      var bl=a.conditionalBlocks||[];
      for(var i=0;i<bl.length;i++){
        if(!bl[i].condition||val(bl[i].condition)){(bl[i].actions||[]).forEach(function(x){run(x,el,ev)});break;}
      }
      return;
    }
    if(a.type==='SET_VARIABLE'){var pv=VARS[a.variableId];VARS[a.variableId]=val(a.variableValue);if(!!pv!==!!VARS[a.variableId])react(a.variableId);return;}
    if(a.type==='BACK'){if(ovs.length)closeOv();return;}
    if(a.type==='CLOSE'){closeOv();return;}
    if(a.type==='URL'&&a.url){window.open(a.url,'_blank','noopener');return;}
    if(a.type!=='NODE') return;
    var nav=a.navigation, d=a.destinationId;
    if(CAPTURE&&nav==='NAVIGATE'){CAPTURE.dest=d;CAPTURE.a=a;return;}
    if(nav==='NAVIGATE'||nav==='SWAP'&&!ovs.length) show(d,a);
    else if(nav==='OVERLAY') openOv(d,a);
    else if(nav==='SWAP'){closeOv(null,true);openOv(d,a);}
    else if(nav==='CHANGE_TO') return change(el,d,a);
    else if(nav==='SCROLL_TO'){var t=stage.querySelector('[data-id="'+d+'"]');if(t)t.scrollIntoView({behavior:'smooth',block:'nearest'});}
  }

  /* variantes gemelas elegidas por una variable (p. ej. el panel de info dentro del post o al costado según la barra lateral):
     si la variable cambia con el panel abierto, el panel pasa a su gemela con una animación suave */
  var TWINS=null;
  function twins(){if(TWINS)return TWINS;TWINS={};
    Object.keys(B.inter).forEach(function(id){(B.inter[id]||[]).forEach(function(r){var got={};
      (r.actions||[]).forEach(function(a){if(!a||a.type!=='CONDITIONAL')return;(a.conditionalBlocks||[]).forEach(function(bl){var c=bl.condition&&bl.condition.value;
        if(!c||c.expressionFunction!=='EQUALS')return;var ar=c.expressionArguments||[],v=ar[0]&&ar[0].value,bv=ar[1]&&ar[1].value;
        if(!v||v.type!=='VARIABLE_ALIAS'||typeof bv!=='boolean')return;
        (bl.actions||[]).forEach(function(x){if(x&&x.type==='NODE'&&x.navigation==='CHANGE_TO'){(got[v.id]=got[v.id]||{})[bv]=x.destinationId}})})});
      Object.keys(got).forEach(function(vid){var g=got[vid];if(g[true]&&g[false]&&g[true]!==g[false]){var T=TWINS[vid]=TWINS[vid]||{};T[g[true]]=[g[false],true];T[g[false]]=[g[true],false];}});
    })});
    return TWINS;}
  function react(vid){var T=twins()[vid];if(!T||!curEl)return;var now=!!VARS[vid];
    [].forEach.call(curEl.querySelectorAll('[data-c]'),function(e){var d=e.getAttribute('data-c'),tw=T[d];if(!tw||e._leaving||!e.isConnected)return;
      if(tw[1]===now)return; // ya es la versión que corresponde al nuevo valor
      change(e,tw[0],{transition:{type:'SMART_ANIMATE',duration:.5,easing:{type:'CUSTOM_CUBIC_BEZIER',easingFunctionCubicBezier:{x1:.22,y1:1,x2:.36,y2:1}}}});});}
  /* cambiar a otra variante: se reemplaza la instancia más cercana del mismo set */
  function target(el,d){
    var set=B.sets[d], box=el;
    while(box&&box!==stage){
      var c=box.getAttribute&&box.getAttribute('data-c');
      if(c&&(c===d||(set&&B.sets[c]===set))) return box;
      box=box.parentElement;
    }
    return el.closest('[data-c]');
  }
  function num(v){return parseFloat(v)||0}
  // mismo contenido visual (mismas imágenes y colores), aunque cambien tamaños
  function sameLook(a,b){var f=function(e){return [].map.call(e.querySelectorAll('img'),function(i){return i.getAttribute('src')}).join()+'|'+(e.innerHTML.match(/(background-color|color):[^;"]+/g)||[]).join()};return f(a)===f(b)}
  function getComputedRGB(c){var d=document.createElement('i');d.style.color=c;document.body.appendChild(d);var r=getComputedStyle(d).color.match(/[\d.]+/g);d.remove();return r&&r.map(Number)}
  function pos(el){return {x:el.dataset.bx!=null?num(el.dataset.bx):num(el.style.left),y:el.dataset.by!=null?num(el.dataset.by):num(el.style.top)}}
  // la instancia puede estar escalada (p. ej. en VR la interfaz es más chica): la variante se escala igual
  function scaleOf(box){var c=box.getAttribute('data-c'),cs=B.csize[c];if(!cs)return 1;var w=num(box.dataset.bw||box.style.width),h=num(box.style.height),k=w/cs[0],ky=h/cs[1];
    // instancia redimensionada (no escalada): otro ancho con el mismo alto -> la variante conserva su escala
    if(h&&Math.abs(k-ky)>0.03)return 1;
    return Math.abs(k-1)<0.02?1:k}
  function scaled(h,k){return k===1?h:h.replace(/(-?\d*\.?\d+)px/g,function(m,n){return (parseFloat(n)*k).toFixed(2)+'px'})}
  function build(box,d){
    var orig=box._orig||box, src, k=box._k||scaleOf(box);
    if(orig.getAttribute('data-c')===d){src=orig._pristine.cloneNode(true);}
    else{var v=B.variants[d];if(!v)return null;var md=(B.screens[cur]||{}).mode;src=html(scaled((v.m&&v.m[md])||v.html,k));}
    overrides(orig,src,k);
    // instancia redimensionada: la variante del mismo tamaño de base toma el tamaño de la instancia
    var oc=B.csize[(orig._pristine||orig).getAttribute('data-c')],dc=B.csize[d];
    if(k===1&&oc&&dc){var bw=num((orig._pristine||orig).style.width),bh=num((orig._pristine||orig).style.height);
      if(Math.abs(dc[0]-oc[0])<1&&Math.abs(bw-oc[0])>1)src.style.width=bw+'px';if(Math.abs(dc[1]-oc[1])<1&&Math.abs(bh-oc[1])>1)src.style.height=bh+'px';}
    var P=pos(box);
    // la variante toma la esquina de la instancia, como en Figma
    src.style.left=P.x+'px';src.style.top=P.y+'px';
    if(box.style.position==='relative'){src.style.position='relative';src.style.flex=box.style.flex;src.style.margin='0';src.style.left='0px';src.style.top='0px';}
    // si la variante tiene otro encuadre, se alinea por la primera capa que ambas comparten
    var bc=[].slice.call(box.children),sc=[].slice.call(src.children);
    var resized=Math.abs(num(box.style.width)-num(src.style.width))>2||Math.abs(num(box.style.height)-num(src.style.height))>2;
    for(var i=0;resized&&box.style.position!=='relative'&&i<bc.length;i++){var nm=bc[i].getAttribute('data-n');if(!nm)continue;
      var m=sc.filter(function(x){return x.getAttribute('data-n')===nm&&Math.abs(num(x.style.width)-num(bc[i].style.width))<2&&Math.abs(num(x.style.height)-num(bc[i].style.height))<2})[0];
      if(m){var pb=pos(bc[i]),pm=pos(m);src.style.left=(P.x+pb.x-pm.x)+'px';src.style.top=(P.y+pb.y-pm.y)+'px';break;}}
    // variante translúcida sobre un fondo sólido (p. ej. el hover negro al 50 %): se compone sobre el color base
    // para que el botón se oscurezca en lugar de volverse gris al quedar solo
    var so=parseFloat(src.style.opacity),base=((orig._pristine||orig).style.backgroundColor||'');
    if(so<1&&src.style.backgroundColor&&/rgb/.test(base)){
      var c1=base.match(/[\d.]+/g).map(Number),c2=getComputedRGB(src.style.backgroundColor);
      if(c2){src.style.backgroundColor='rgb('+[0,1,2].map(function(i){return Math.round(c1[i]*(1-so)+c2[i]*so)}).join(',')+')';src.style.opacity='';}
    }
    src._orig=orig;src._k=k;
    return src;
  }
  // variante puente (sale sola en ~1 ms hacia otra, con un cambio casi instantáneo): se va directo al destino
  function hop(d){
    for(var i=0;i<4;i++){var r=(B.inter[d]||[]).filter(function(x){return x.trigger.type==='AFTER_TIMEOUT'&&(x.trigger.timeout||0)<0.02})[0];if(!r)break;
      var acts=r.actions||[],nx=acts.filter(function(a){return a.type==='NODE'&&a.navigation==='CHANGE_TO'})[0];
      if(!nx||acts.some(function(a){return a!==nx&&a.type!=='SET_VARIABLE'})||((nx.transition||{}).duration||0)>0.05)break;
      acts.forEach(function(a){if(a.type==='SET_VARIABLE')VARS[a.variableId]=val(a.variableValue)});d=nx.destinationId;}
    return d;
  }
  /* como en Figma: los textos e imágenes que la instancia cambió respecto de su componente se conservan en la otra variante */
  function overrides(orig,src,k){
    var inst=orig._pristine||orig,dv=B.variants[inst.getAttribute('data-c')];
    // sin la versión base del componente, se compara contra la propia variante: todo lo distinto se conserva
    var md=(B.screens[cur]||{}).mode,D=dv?html(scaled((dv.m&&dv.m[md])||dv.html,k)):src,LI=layers(inst),LD=layers(D),LS=layers(src);
    Object.keys(LS).forEach(function(key){var i=LI[key],d=LD[key],s=LS[key];if(!i||!d)return;
      if(s.classList.contains('t')&&i.classList.contains('t')&&d.classList.contains('t')){if(i.textContent!==d.textContent)s.innerHTML=i.innerHTML;}
      else if(s.tagName==='IMG'&&i.tagName==='IMG'&&d.tagName==='IMG'){if(/\.(webp|png|jpe?g)$/.test(i.getAttribute('src'))&&i.getAttribute('src')!==d.getAttribute('src'))s.setAttribute('src',i.getAttribute('src'));}
      else if(s.tagName==='IMG'&&i.tagName!=='IMG'&&/url\([^)]*\.webp/.test(i.style.background||i.style.backgroundImage)){
        // foto de la instancia (relleno con máscara) donde la variante tiene un marcador: se usa la capa de la instancia en la posición de la variante
        var cp=i.cloneNode(true);['left','top','width','height','position','flex','margin','transform','transform-origin'].forEach(function(pr){cp.style.setProperty(pr,s.style.getPropertyValue(pr))});
        cp.removeAttribute('data-id');s.parentNode.replaceChild(cp,s);}
      else if(i.style.backgroundImage!==d.style.backgroundImage&&/\.webp/.test(i.style.backgroundImage)){s.style.backgroundImage=i.style.backgroundImage;s.style.backgroundSize=i.style.backgroundSize;s.style.backgroundPosition=i.style.backgroundPosition;}
    });
  }
  function change(el,d,a){
    d=hop(d);
    var box=target(el,d); if(!box) return null;
    while(box._next&&box._next.isConnected)box=box._next;
    if(!box.parentNode||box._leaving) return null;
    if(box.getAttribute('data-c')===d) return null;
    if(!box._orig&&!box._pristine){box._pristine=box.cloneNode(true);box._k=scaleOf(box);}
    var src=build(box,d); if(!src) return null;
    // estado anterior intacto, para volver a él al terminar un hover
    var prev=box.cloneNode(true);prev._orig=box._orig;prev._pristine=box._pristine;prev._k=box._k;src._prev=prev;
    var t=box._instant?null:tr(a);swap(box,src,t,null,null,{over:1});
    arm(src,t?t.ms:0);
    return src;
  }

  /* al pasar a otra pantalla (p. ej. otro modo de color), lo abierto o activo sigue igual */
  function pathOf(el,root){var parts=[],e=el;while(e&&e!==root){var n=(e._orig||e).getAttribute&&(e._orig||e).getAttribute('data-n');
      if(n!=null){var i=1,sb=e.previousElementSibling;while(sb){if(((sb._orig||sb).getAttribute('data-n'))===n)i++;sb=sb.previousElementSibling}parts.unshift(n+'#'+i)}e=e.parentElement}
    return e===root?parts.join('/'):null}
  function plain(nm){return (nm||'').replace(/\b(light|dim|dark)\b/gi,'').replace(/\s+/g,' ').trim()}
  function carry(old,nu){
    var changed=[].filter.call(old.querySelectorAll('[data-c]'),function(e){var nm=e.getAttribute('data-n')||'';
      return e._orig&&!e._leaving&&!/hover|mouse down/i.test(nm)&&!/ select$/.test(nm)&&!e.querySelector('[data-n="light mode"],[data-n="dim 1"]')&&!/^light mode=/.test(nm)});
    if(!changed.length)return;
    var idx={};[].forEach.call(nu.querySelectorAll('[data-c]'),function(e){var k=pathOf(e,nu);if(k)idx[k]=e});
    changed.forEach(function(e){var k=pathOf(e,old),nb=k&&idx[k];if(!nb||!nb.parentNode)return;
      var d=e.getAttribute('data-c'),set=B.sets[d],ns=B.sets[nb.getAttribute('data-c')];
      if(ns!==set){var want=plain((B.variants[d]||{}).name),alt=Object.keys(B.sets).filter(function(x){return B.sets[x]===ns&&B.variants[x]&&plain(B.variants[x].name)===want})[0];if(!alt)return;d=alt;}
      if(nb.getAttribute('data-c')===d)return;
      nb._pristine=nb.cloneNode(true);nb._k=scaleOf(nb);var src=build(nb,d);if(!src)return;
      nb.parentNode.replaceChild(src,nb);});
  }
  /* pantallas */
  /* entrar y salir de AR/VR: en Figma son dos saltos rápidos (IN/BACK de 0,2 s) con la interfaz desarmada en medio.
     Aquí es una sola transición continua: la interfaz plana se posa en el espacio mientras el entorno aparece, y al salir, al revés */
  var CAPTURE=null;
  function autoDest(id){var r=(B.inter[id]||[]).filter(function(x){return x.trigger.type==='AFTER_TIMEOUT'});if(!r.length)return null;
    CAPTURE={};r.forEach(function(x){(x.actions||[]).forEach(function(a){run(a,null)})});var c=CAPTURE;CAPTURE=null;return c.dest?c:null}
  function scrInner(root){var sc=root.querySelector('.scr-root');return sc&&sc.firstElementChild}
  function xrParts(root){var inner=scrInner(root);if(!inner)return null;var env=[],ui=[],panel=null;
    [].forEach.call(inner.children,function(c){var n=c.getAttribute('data-n')||'';if(/backgrounds/i.test(n))env.push(c);else{ui.push(c);if(n==='background')panel=c;}});
    [].forEach.call(root.children,function(c){if(!c.classList.contains('scr-root'))ui.push(c)});
    return {env:env,ui:ui,panel:panel}}
  function stageRect(el){var r=el.getBoundingClientRect(),q=stage.getBoundingClientRect();return {x:(r.left-q.left)/SCALE,y:(r.top-q.top)/SCALE,w:r.width/SCALE,h:r.height/SCALE}}
  var XE='cubic-bezier(.65,.02,.2,1)',XS='cubic-bezier(.22,1,.36,1)';
  function xrShow(id,dir){
    var s=B.screens[id];if(!s)return;
    timers.forEach(clearTimeout);timers=[];while(ovs.length)closeOv(null,true);
    [].slice.call(stage.children).forEach(function(c){if(c!==curEl&&!c.classList.contains('ovl'))c.remove()});
    var old=curEl,nu=html(s.html);cur=id;curEl=nu;fit();if(old)carry(old,nu);
    old.classList.add('gone');
    var W=num(nu.style.width)||1920,H=num(nu.style.height)||1080,D=1150;
    if(dir==='in'){
      stage.insertBefore(nu,old);home(nu,0,0);
      var P=xrParts(nu),R=P&&P.panel?stageRect(P.panel):{x:W*.08,y:H*.08,w:W*.84,h:H*.84};
      P.env.forEach(function(e){e.style.opacity='0';e.style.filter='blur(18px)';e.style.transform='scale(1.1)';e.style.transformOrigin='50% 50%'});
      P.ui.forEach(function(e){e._op=e.style.opacity;e.style.opacity='0'});
      old.style.transformOrigin='0 0';old.style.overflow='hidden';old.style.boxShadow='0 0 0 rgba(0,0,0,0)';reflow(old);
      old.style.transition='transform '+D+'ms '+XE+',border-radius '+D+'ms '+XE+',box-shadow '+D+'ms '+XE+',opacity 280ms ease '+(D-330)+'ms';
      old.style.transform='translate('+R.x+'px,'+R.y+'px) scale('+(R.w/W)+','+(R.h/H)+')';old.style.borderRadius=(20*W/R.w)+'px';
      old.style.boxShadow='0 '+(30*W/R.w)+'px '+(80*W/R.w)+'px rgba(0,0,0,.35)';old.style.opacity='0';
      P.env.forEach(function(e){e.style.transition='opacity 700ms ease 120ms,filter '+(D+150)+'ms '+XS+',transform '+(D+250)+'ms '+XS;e.style.opacity='';e.style.filter='';e.style.transform=''});
      P.ui.forEach(function(e){e.style.transition='opacity 300ms ease '+(D-360)+'ms';e.style.opacity=e._op||''});
      setTimeout(function(){old.remove();P.env.concat(P.ui).forEach(function(e){e.style.transition='';e.style.filter='';e.style.transform=''})},D+300);
    }else{
      var Q=xrParts(old),R2=Q&&Q.panel?stageRect(Q.panel):{x:W*.08,y:H*.08,w:W*.84,h:H*.84};
      stage.appendChild(nu);home(nu,0,0);
      nu.style.transformOrigin='0 0';nu.style.overflow='hidden';nu.style.opacity='0';
      nu.style.transform='translate('+R2.x+'px,'+R2.y+'px) scale('+(R2.w/W)+','+(R2.h/H)+')';nu.style.borderRadius=(20*W/R2.w)+'px';reflow(nu);
      nu.style.transition='opacity 260ms ease,transform '+D+'ms '+XE+',border-radius '+D+'ms '+XE;
      nu.style.opacity='1';nu.style.transform='translate(0px,0px) scale(1,1)';nu.style.borderRadius='0px';
      if(Q){Q.ui.forEach(function(e){e.style.transition='opacity 240ms ease';e.style.opacity='0'});
        Q.env.forEach(function(e){e.style.transformOrigin='50% 50%';e.style.transition='opacity 900ms ease 150ms,filter '+D+'ms '+XE+',transform '+D+'ms '+XE;e.style.opacity='0';e.style.filter='blur(18px)';e.style.transform='scale(1.1)'});}
      setTimeout(function(){old.remove();nu.style.transition='';nu.style.transform='';nu.style.transformOrigin='';nu.style.overflow='';nu.style.borderRadius='';nu.style.opacity=''},D+120);
    }
    arm(nu,D);
  }
  function show(id,a){
    var s=B.screens[id];if(!s)return;
    var wasXR=!!(curEl&&curEl.querySelector('.scr-root'));
    if(s.name==='IN'&&curEl&&!wasXR){var c=autoDest(id);if(c&&B.screens[c.dest]){xrShow(c.dest,'in');return;}}
    if(s.name==='BACK'&&wasXR){var c2=autoDest(id);if(c2&&B.screens[c2.dest]){xrShow(c2.dest,'out');return;}}
    timers.forEach(clearTimeout);timers=[];
    while(ovs.length)closeOv(null,true);
    // pantallas que aún se estaban yendo: fuera de inmediato
    [].slice.call(stage.children).forEach(function(c){if(c!==curEl&&!c.classList.contains('ovl'))c.remove()});
    var old=curEl, nu=html(s.html);
    cur=id;curEl=nu;fit();
    if(old)carry(old,nu);
    var t=tr(a);
    var osc=old&&old.querySelector('.scr-root'),dx=0,dy=0;
    if(osc){dx=osc.scrollLeft-num(osc.getAttribute('data-sx'));dy=osc.scrollTop-num(osc.getAttribute('data-sy'));}
    var keepScroll=function(){home(nu,dx,dy);if(!old)return;var os=[].slice.call(old.querySelectorAll('.scr:not(.scr-root)')),ns=[].slice.call(nu.querySelectorAll('.scr:not(.scr-root)'));
      os.forEach(function(o,i){if(o.scrollTop&&ns[i]&&ns[i].getAttribute('data-n')===o.getAttribute('data-n'))ns[i].scrollTop=o.scrollTop})};
    if(old&&old.parentNode){swap(old,nu,t,null,keepScroll);}else{stage.appendChild(nu);home(nu,0,0);}
    arm(nu,t?t.ms:0);
  }
  function bgOf(el){var b=el&&(el.style.backgroundColor||el.style.background);var m=b&&/#[0-9a-f]{6}|rgba?\([^)]*\)/i.exec(b);return m?m[0]:'#F1F2F4'}

  /* overlays */
  function openOv(id,a){
    var o=B.overlays[id]||B.variants[id];if(!o)return;
    var t=tr(a);
    var lay=document.createElement('div');lay.className='ovl';
    var bg=o.bg&&o.bg.type==='SOLID_COLOR'&&o.bg.color;
    // sin dato de fondo en el archivo: el oscurecido que se ve en el prototipo de Figma
    if(!o.bg)lay.style.background='rgba(16,15,10,.38)';
    if(bg)lay.style.background='rgba('+Math.round(bg.r*255)+','+Math.round(bg.g*255)+','+Math.round(bg.b*255)+','+(bg.a==null?1:bg.a)+')';
    var el=html(o.html);el.style.left='0px';el.style.top='0px';
    var box=document.createElement('div');box.className='ovb';box.style.width=o.w+'px';box.style.height=o.h+'px';
    var p=a&&a.overlayRelativePosition, s=B.screens[cur]||{w:1920,h:1080};
    if(o.pos==='MANUAL'&&p){box.style.left=p.x+'px';box.style.top=p.y+'px';}
    else{box.style.left=((s.w-o.w)/2)+'px';box.style.top=((s.h-o.h)/2)+'px';}
    box.appendChild(el);lay.appendChild(box);stage.appendChild(lay);
    if(o.close!=='NONE')lay.addEventListener('click',function(e){if(!box.contains(e.target))closeOv()});
    lay._t=t;ovs.push(lay);
    if(t){
      var T=t.ms+'ms '+t.ease;
      if(t.type==='MOVE_IN'||t.type==='SLIDE_IN'||t.type==='PUSH'){
        var off={LEFT:'translateX('+(s.w-parseFloat(box.style.left))+'px)',RIGHT:'translateX(-'+(parseFloat(box.style.left)+o.w)+'px)',
          TOP:'translateY('+(s.h-parseFloat(box.style.top))+'px)',BOTTOM:'translateY(-'+(parseFloat(box.style.top)+o.h)+'px)'}[t.dir||'LEFT'];
        box.style.transform=off;lay.style.opacity='1';reflow(box);box.style.transition='transform '+T;box.style.transform='none';
      }else{lay.style.opacity='0';reflow(lay);lay.style.transition='opacity '+T;lay.style.opacity='1';}
    }
    arm(el);
  }
  function closeOv(ev,now){
    var l=ovs.pop();if(!l)return;
    var t=l._t;if(now||!t){l.remove();return;}
    var T=t.ms+'ms '+t.ease;l.style.transition='opacity '+T;l.style.opacity='0';after(t.ms,function(){l.remove()});
  }

  /* ---------- disparadores ---------- */
  function list(el,type){var r=B.inter[el.getAttribute('data-id')]||[];return r.filter(function(x){return x.trigger.type===type})}
  function fire(el,type,ev){var r=list(el,type),out=[];r.forEach(function(x){(x.actions||[]).forEach(function(a){var s=run(a,el,ev);if(s)out.push([s,a])})});return out}
  // el nodo más profundo con esa interacción gana, como en Figma
  function find(t,type){
    while(t&&t!==document&&t!==stage){if(t.getAttribute&&t.getAttribute('data-id')&&list(t,type).length)return t;t=t.parentNode}
    return null;
  }
  function visible(a){
    if(!a) return false;
    if(a.type==='CONDITIONAL') return (a.conditionalBlocks||[]).some(function(b){return (b.actions||[]).some(visible)});
    return a.type==='NODE'||a.type==='CLOSE'||a.type==='BACK'||a.type==='URL';
  }
  function markTop(root){[].slice.call(root.querySelectorAll('[data-n$=" select"]')).concat(/ select$/.test(root.getAttribute('data-n')||'')?[root]:[]).forEach(function(m){
    var ic=[].slice.call(m.querySelectorAll('[data-n]')).filter(function(x){return x.tagName==='DIV'&&ICONS.indexOf(x.getAttribute('data-n'))>=0});if(!ic.length)return;
    ic.forEach(function(x){x.classList.add('micon');
      });})}
  function arm(root,delay){delay=delay||0;setTimeout(function(){if(root.isConnected)markTop(root)},(delay||0)+30);
    var els=[root].concat([].slice.call(root.querySelectorAll('[data-id]')));
    els.forEach(function(el){
      list(el,'AFTER_TIMEOUT').forEach(function(x){
        timers.push(setTimeout(function(){if(el.isConnected)(x.actions||[]).forEach(function(a){run(a,el)})},delay+Math.max(1,(x.trigger.timeout||0)*1000)));
      });
      // la manito solo si el clic produce algo visible (no si apenas guarda una variable)
      // manito en todo punto interactivo, como en el visor de Figma (clic, hover, presionar)
      var clickable=(B.inter[el.getAttribute('data-id')]||[]).some(function(x){return x.trigger.type!=='AFTER_TIMEOUT'&&(x.actions||[]).some(function(a){return visible(a)||(a&&a.type==='SET_VARIABLE'&&x.trigger.type==='ON_CLICK')})});
      if(clickable)el.classList.add('hot');
    });
  }
  function helpOf(t){while(t&&t!==stage){if(t.textContent&&t.textContent.trim()==='Help?'&&t.getBoundingClientRect().height<120*SCALE+40)return t;t=t.parentElement}return null}
  stage.addEventListener('click',function(e){if(helpOf(e.target)&&window.openGuide){window.openGuide();return}});
  stage.addEventListener('mouseover',function(e){var h=helpOf(e.target);if(h)h.style.cursor='pointer'});
  var calm=null;
  /* menú de modos: al elegir, el panel se recoge, el ícono elegido sube al lugar superior y se vuelve blanco */
  var ICONS=['light mode','dim','dark'];
  function menuOf(el){var m=el.closest&&el.closest('[data-n$=" select"]');return m&&ICONS.indexOf(el.getAttribute('data-n'))>=0?m:null}
  var ALTMOON=null;
  function altMoon(){if(ALTMOON===null&&B.altmoon)ALTMOON=B.altmoon;if(ALTMOON===null){var hv=html(B.variants['587:4555'].html),h2=hv&&hv.querySelector('img[data-n="dim 2"]');ALTMOON=h2?h2.getAttribute('src'):''}return ALTMOON}
  stage.addEventListener('mouseover',function(e){var d=e.target.closest&&e.target.closest('.micon[data-n="dim"]');if(!d||d._alt||(e.relatedTarget&&d.contains(e.relatedTarget)))return;
    var m=d.querySelector('img[data-n="dim 2"]');if(!m||!altMoon())return;d._alt=true;
    // la luna con el hueco amplio, pintada con el color de ícono del modo actual (máscara)
    var mk=document.createElement('div');mk.className='f pe0 altmoon';mk.style.cssText=m.style.cssText;var col=(B.icon||{})[(B.screens[cur]||{}).mode]||'#000';
    mk.style.background=col;mk.style.webkitMask='url("'+altMoon()+'") center/100% 100% no-repeat';mk.style.mask='url("'+altMoon()+'") center/100% 100% no-repeat';
    m.parentNode.insertBefore(mk,m.nextSibling);m.style.opacity='0';});
  stage.addEventListener('mouseout',function(e){var d=e.target.closest&&e.target.closest('.micon[data-n="dim"]');if(!d||!d._alt||(e.relatedTarget&&d.contains(e.relatedTarget)))return;
    var m=d.querySelector('img[data-n="dim 2"]');if(m)m.style.opacity='';var mk=d.querySelector('.altmoon');if(mk)mk.remove();d._alt=null;});
  function pickMode(el,menu,go){
    if(menu._busy)return;menu._busy=true;
    if(el._alt){var mm2=el.querySelector('img[data-n="dim 2"]');if(mm2)mm2.style.opacity='';var mk2=el.querySelector('.altmoon');if(mk2)mk2.remove();el._alt=null;}
    var ic=[].slice.call(menu.querySelectorAll('[data-n]')).filter(function(x){return x.tagName==='DIV'&&ICONS.indexOf(x.getAttribute('data-n'))>=0});
    var top=ic.reduce(function(a,b){return b.getBoundingClientRect().top<a.getBoundingClientRect().top?b:a});
    var dy=(top.getBoundingClientRect().top-el.getBoundingClientRect().top)/SCALE;
    var bg=[].slice.call(menu.children).filter(function(x){return /background/i.test(x.getAttribute('data-n')||'')})[0];
    var E='cubic-bezier(.22,1,.36,1)';
    el.classList.remove('micon');
    ic.forEach(function(x){x.style.transition='transform 420ms '+E+',opacity 220ms ease-out,filter 120ms ease-out';
      if(x===el){x.style.transform='translateY('+dy+'px)';x.style.filter='brightness(0) invert(1)';}
      else{x.style.opacity='0';x.style.transform='scale(.7)';}});
    if(bg){bg.style.transition='height 420ms '+E+',opacity 220ms ease-out';bg.style.height='66px';bg.style.opacity='0';}
    setTimeout(function(){menu._instant=true;go();},400);
  }
  stage.addEventListener('click',function(e){var el=find(e.target,'ON_CLICK');var mm=el&&menuOf(el);
    if(mm&&!mm._busy&&el!==[].slice.call(mm.querySelectorAll('[data-n]')).filter(function(x){return x.tagName==='DIV'&&ICONS.indexOf(x.getAttribute('data-n'))>=0}).reduce(function(a,b){return b.getBoundingClientRect().top<a.getBoundingClientRect().top?b:a})){
      e.stopPropagation();endHover(true);pickMode(el,mm,function(){fire(el,'ON_CLICK',e)});return;}
    if(el){e.stopPropagation();endHover(true);var out=fire(el,'ON_CLICK',e);
    var s=out.length?out[out.length-1][0]:null;calm=s||el.closest('[data-c]')||el;}});
  stage.addEventListener('mousedown',function(e){var el=find(e.target,'MOUSE_DOWN');if(el)fire(el,'MOUSE_DOWN',e)});
  stage.addEventListener('mouseup',function(e){var el=find(e.target,'MOUSE_UP');if(el)fire(el,'MOUSE_UP',e)});

  /* hover: ON_HOVER vuelve al estado anterior al salir, con la misma transición; MOUSE_ENTER no vuelve */
  var hov=null;
  stage.addEventListener('mouseover',function(e){
    var el=find(e.target,'MOUSE_ENTER');
    if(el&&!list(el,'ON_HOVER').length&&!(e.relatedTarget&&el.contains(e.relatedTarget)))fire(el,'MOUSE_ENTER',e);
    var h=find(e.target,'ON_HOVER');
    if(h&&calm&&calm.isConnected&&(calm.contains(h)||h.contains(calm)))h=null;
    if(h&&(!hov||!hov.el.isConnected||!(hov.el===h||hov.el.contains(h)||h.contains(hov.el)))){
      endHover();
      var res=fire(h,'ON_HOVER',e);
      if(res.length){var sw=res[res.length-1],tt=tr(sw[1]);hov={el:sw[0],a:sw[1],until:Date.now()+(tt?tt.ms:0)+60};}
    }
  });
  stage.addEventListener('mouseout',function(e){
    var t=e.target;
    while(t&&t!==stage){if(t.getAttribute&&list(t,'MOUSE_LEAVE').length&&t.isConnected&&!(e.relatedTarget&&t.contains(e.relatedTarget)))fire(t,'MOUSE_LEAVE',e);t=t.parentNode}
  });
  window.addEventListener('mousemove',function(e){
    if(calm){if(!calm.isConnected)calm=null;else{var q=calm.getBoundingClientRect();if(e.clientX<q.left||e.clientX>q.right||e.clientY<q.top||e.clientY>q.bottom)calm=null;}}
    if(!hov||Date.now()<hov.until)return;
    if(!hov.el.isConnected){hov=null;return}
    var r=hov.el.getBoundingClientRect();
    if(e.clientX<r.left-2||e.clientX>r.right+2||e.clientY<r.top-2||e.clientY>r.bottom+2)endHover();
  });
  function endHover(silent){
    if(!hov)return;var h=hov;hov=null;
    // si el propio componente ya volvió (p. ej. con su MOUSE_LEAVE), no se agrega otra copia
    if(silent||!h.el.isConnected||!h.el._prev||h.el._leaving)return;
    // vuelve a la variante de origen con la misma transición
    var pv=h.el._prev;if(!pv)return;
    var back=pv.cloneNode(true);back._orig=pv._orig;back._pristine=pv._pristine;back._k=pv._k;
    swap(h.el,back,tr(h.a),null,null,{over:1});arm(back);
  }

  show(B.start);
})();
