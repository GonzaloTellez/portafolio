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
  function home(root){[].forEach.call(root.querySelectorAll('.scr-root'),function(sc){
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
    sc.scrollLeft=+sc.getAttribute('data-sx');sc.scrollTop=+sc.getAttribute('data-sy')})}
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
  var PROPS=['left','top','width','height','opacity','background-color','color','border-radius'];
  function snap(el){var s=el.style,o={};PROPS.forEach(function(p){o[p]=s.getPropertyValue(p)});return o}
  // valor actual en pantalla (sirve si la capa aún está a mitad de otra transición)
  function live(el){var s=el.style,c=getComputedStyle(el),o={};PROPS.forEach(function(p){o[p]=s.getPropertyValue(p)?c.getPropertyValue(p):''});return o}

  /* reemplaza oldEl por newEl con la transición de Figma */
  function swap(oldEl,newEl,t,onDone){
    var par=oldEl.parentNode;
    if(!t||t.type==='INSTANT'||!t.ms){par.replaceChild(newEl,oldEl);onDone&&onDone();return;}
    var T=t.ms+'ms '+t.ease;
    if(t.type==='SMART_ANIMATE'){
      var A=layers(oldEl),Bm=layers(newEl), keep=[];
      // el estado viejo queda detrás para desvanecer lo que desaparece
      par.insertBefore(newEl,oldEl.nextSibling);
      oldEl.style.pointerEvents='none';
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
        flipped.push(n);return false;
      });
      keep=keep.filter(function(){return true});
      pairs.forEach(function(p){
        var o=p[0],n=p[1],from=live(o),to=snap(n);
        var same=o.tagName===n.tagName&&(o.tagName!=='IMG'||o.getAttribute('src')===n.getAttribute('src'));
        if(same&&o!==oldEl) o.style.visibility='hidden';
        // si la capa venía invisible, su color no se interpola (evita destellos grises)
        var hid=parseFloat(from.opacity)===0;
        PROPS.forEach(function(pr){if(hid&&(pr==='background-color'||pr==='color'))return;if(from[pr]!==''&&from[pr]!==to[pr]&&!(p[1]===newEl&&(pr==='left'||pr==='top')))n.style.setProperty(pr,from[pr]);});
        if(!same){var op=to.opacity||'1';n.style.opacity='0';keep.push(function(){n.style.opacity=op;});}
        keep.push(function(){n.style.transition=PROPS.map(function(x){return x+' '+T}).join(',');PROPS.forEach(function(pr){n.style.setProperty(pr,to[pr])});});
      });
      reflow(newEl);
      keep.forEach(function(f){f()});
      oldEl.style.transition='opacity '+T;oldEl.style.opacity='0';
      after(t.ms,function(){oldEl.remove();Object.keys(Bm).forEach(function(k){Bm[k].style.transition=''});flipped.forEach(function(f){f.style.transformOrigin=''});newEl.style.transition='';onDone&&onDone();});
      return;
    }
    // DISSOLVE (y el resto): fundido cruzado
    par.insertBefore(newEl,oldEl.nextSibling);
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
    if(a.type==='SET_VARIABLE'){VARS[a.variableId]=val(a.variableValue);return;}
    if(a.type==='BACK'){if(ovs.length)closeOv();return;}
    if(a.type==='CLOSE'){closeOv();return;}
    if(a.type==='URL'&&a.url){window.open(a.url,'_blank','noopener');return;}
    if(a.type!=='NODE') return;
    var nav=a.navigation, d=a.destinationId;
    if(nav==='NAVIGATE'||nav==='SWAP'&&!ovs.length) show(d,a);
    else if(nav==='OVERLAY') openOv(d,a);
    else if(nav==='SWAP'){closeOv(null,true);openOv(d,a);}
    else if(nav==='CHANGE_TO') return change(el,d,a);
    else if(nav==='SCROLL_TO'){var t=stage.querySelector('[data-id="'+d+'"]');if(t)t.scrollIntoView({behavior:'smooth',block:'nearest'});}
  }

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
  function build(box,d){
    var orig=box._orig||box, src;
    if(orig.getAttribute('data-c')===d){src=orig._pristine.cloneNode(true);}
    else{var v=B.variants[d];if(!v)return null;src=html(v.html);}
    src.style.left=box.style.left;src.style.top=box.style.top;
    // si la variante tiene otro encuadre, se alinea por la primera capa que ambas comparten
    // (solo si cambia el tamaño del marco y hay una capa idéntica en tamaño; si no, se respeta la esquina, como Figma)
    var bc=[].slice.call(box.children),sc=[].slice.call(src.children);
    var resized=Math.abs(parseFloat(box.style.width)-parseFloat(src.style.width))>2||Math.abs(parseFloat(box.style.height)-parseFloat(src.style.height))>2;
    for(var i=0;resized&&i<bc.length;i++){var nm=bc[i].getAttribute('data-n');if(!nm)continue;
      var m=sc.filter(function(x){return x.getAttribute('data-n')===nm&&Math.abs(parseFloat(x.style.width)-parseFloat(bc[i].style.width))<2&&Math.abs(parseFloat(x.style.height)-parseFloat(bc[i].style.height))<2})[0];
      if(m){src.style.left=(parseFloat(box.style.left)+parseFloat(bc[i].style.left)-parseFloat(m.style.left))+'px';
        src.style.top=(parseFloat(box.style.top)+parseFloat(bc[i].style.top)-parseFloat(m.style.top))+'px';break;}}
    src._orig=orig;
    return src;
  }
  function change(el,d,a){
    var box=target(el,d); if(!box||!box.parentNode) return null;
    if(!box._orig&&!box._pristine) box._pristine=box.cloneNode(true);
    var src=build(box,d); if(!src) return null;
    var t=tr(a);swap(box,src,t);
    arm(src,t?t.ms:0);
    return src;
  }

  /* pantallas */
  function show(id,a){
    var s=B.screens[id];if(!s)return;
    timers.forEach(clearTimeout);timers=[];
    while(ovs.length)closeOv(null,true);
    // pantallas que aún se estaban yendo: fuera de inmediato
    [].slice.call(stage.children).forEach(function(c){if(c!==curEl&&!c.classList.contains('ovl'))c.remove()});
    var old=curEl, nu=html(s.html);
    cur=id;curEl=nu;fit();
    var t=tr(a);
    if(old&&old.parentNode){swap(old,nu,t);}else stage.appendChild(nu);
    home(nu);
    document.body.style.background=bgOf(nu);
    arm(nu,t?t.ms:0);
  }
  function bgOf(el){var b=el&&(el.style.backgroundColor||el.style.background);var m=b&&/#[0-9a-f]{6}|rgba?\([^)]*\)/i.exec(b);return m?m[0]:'#F1F2F4'}

  /* overlays */
  function openOv(id,a){
    var o=B.overlays[id]||B.variants[id];if(!o)return;
    var t=tr(a);
    var lay=document.createElement('div');lay.className='ovl';
    var bg=o.bg&&o.bg.type==='SOLID_COLOR'&&o.bg.color;
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
  function arm(root,delay){delay=delay||0;
    var els=[root].concat([].slice.call(root.querySelectorAll('[data-id]')));
    els.forEach(function(el){
      list(el,'AFTER_TIMEOUT').forEach(function(x){
        timers.push(setTimeout(function(){if(el.isConnected)(x.actions||[]).forEach(function(a){run(a,el)})},delay+Math.max(1,(x.trigger.timeout||0)*1000)));
      });
      // la manito solo si el clic produce algo visible (no si apenas guarda una variable)
      var clickable=list(el,'ON_CLICK').some(function(x){return (x.actions||[]).some(visible)});
      if(clickable)el.style.cursor='pointer';
    });
  }
  stage.addEventListener('click',function(e){var el=find(e.target,'ON_CLICK');if(el){e.stopPropagation();endHover(true);fire(el,'ON_CLICK',e)}});
  stage.addEventListener('mousedown',function(e){var el=find(e.target,'MOUSE_DOWN');if(el)fire(el,'MOUSE_DOWN',e)});
  stage.addEventListener('mouseup',function(e){var el=find(e.target,'MOUSE_UP');if(el)fire(el,'MOUSE_UP',e)});

  /* hover: ON_HOVER vuelve al estado anterior al salir, con la misma transición; MOUSE_ENTER no vuelve */
  var hov=null;
  stage.addEventListener('mouseover',function(e){
    var el=find(e.target,'MOUSE_ENTER');
    if(el&&!(e.relatedTarget&&el.contains(e.relatedTarget)))fire(el,'MOUSE_ENTER',e);
    var h=find(e.target,'ON_HOVER');
    if(h&&(!hov||!(hov.el===h||hov.el.contains(h)||h.contains(hov.el)))){
      endHover();
      var res=fire(h,'ON_HOVER',e);
      if(res.length){var sw=res[res.length-1];hov={el:sw[0],a:sw[1]};}
    }
  });
  stage.addEventListener('mouseout',function(e){
    // MOUSE_LEAVE en cada capa que el puntero abandona
    var t=e.target;
    while(t&&t!==stage){if(t.getAttribute&&list(t,'MOUSE_LEAVE').length&&!(e.relatedTarget&&t.contains(e.relatedTarget)))fire(t,'MOUSE_LEAVE',e);t=t.parentNode}
    if(hov&&hov.el.isConnected&&!(e.relatedTarget&&hov.el.contains(e.relatedTarget)))endHover();
  });
  function endHover(silent){
    if(!hov)return;var h=hov;hov=null;
    if(silent||!h.el.isConnected||!h.el._orig)return;
    // vuelve a la variante de origen con la misma transición
    var back=h.el._orig._pristine?h.el._orig._pristine.cloneNode(true):null;if(!back)return;
    back.style.left=h.el._orig.style.left;back.style.top=h.el._orig.style.top;
    swap(h.el,back,tr(h.a));arm(back);
  }

  show(B.start);
})();
