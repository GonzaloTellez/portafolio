/* Reproductor del prototipo de OVER Collab Hub.
   Interpreta las interacciones exportadas de Figma (B.inter): navegar, overlays, cambiar variante,
   variables booleanas y condiciones. El HTML de cada pantalla y variante viene en B (build.json). */
(function(){
  var B=window.HUB, stage=document.getElementById('stage'), app=document.getElementById('app');
  var VARS={}, timers=[], cur=null, ovs=[];
  var T=240; // duración de las transiciones (ms)

  /* ---------- escala: el lienzo de 1920x1080 ocupa la ventana ---------- */
  function fit(){
    var s=B.screens[cur]||{w:1920,h:1080}, W=app.clientWidth, H=app.clientHeight, k=Math.min(W/s.w,H/s.h);
    stage.style.width=s.w+'px';stage.style.height=s.h+'px';
    stage.style.transform='translate('+((W-s.w*k)/2)+'px,'+((H-s.h*k)/2)+'px) scale('+k+')';
  }
  window.addEventListener('resize',fit);

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

  /* ---------- utilidades DOM ---------- */
  function html(s){var d=document.createElement('div');d.innerHTML=s;return d.firstElementChild;}
  function fade(el,inn){el.style.transition='opacity '+T+'ms';el.style.opacity=inn?0:1;requestAnimationFrame(function(){requestAnimationFrame(function(){el.style.opacity=inn?1:0})})}
  function dur(a){var t=a&&a.transition;return t&&t.type&&t.type!=='INSTANT'?Math.min(600,(t.duration||0.3)*1000):0}

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
    else if(nav==='SWAP'){closeOv(true);openOv(d,a);}
    else if(nav==='CHANGE_TO') change(el,d,a);
    else if(nav==='SCROLL_TO'){var t=stage.querySelector('[data-id="'+d+'"]');if(t)t.scrollIntoView({behavior:'smooth',block:'nearest'});}
  }

  /* cambiar a otra variante: se reemplaza la instancia más cercana del mismo set */
  function change(el,d,a){
    var set=B.sets[d], box=el;
    while(box&&box!==stage){
      var c=box.getAttribute&&box.getAttribute('data-c');
      if(c&&(c===d||(set&&B.sets[c]===set))) break;
      box=box.parentElement;
    }
    if(!box||box===stage) box=el.closest('[data-c]');
    if(!box) return;
    var orig=box._orig||box;
    var src;
    if(orig.getAttribute('data-c')===d) src=orig.cloneNode(true);
    else { var v=B.variants[d]; if(!v) return; src=html(v.html); }
    // la variante toma el lugar (posición) de la instancia actual
    src.style.left=box.style.left;src.style.top=box.style.top;
    // si la variante tiene otro encuadre, se alinea por la primera capa que ambas comparten
    var bc=[].slice.call(box.children),sc=[].slice.call(src.children);
    for(var i=0;i<bc.length;i++){var nm=bc[i].getAttribute('data-n');if(!nm)continue;
      var m=sc.filter(function(x){return x.getAttribute('data-n')===nm})[0];
      if(m){src.style.left=(parseFloat(box.style.left)+parseFloat(bc[i].style.left)-parseFloat(m.style.left))+'px';
        src.style.top=(parseFloat(box.style.top)+parseFloat(bc[i].style.top)-parseFloat(m.style.top))+'px';break;}}
    src._orig=orig;
    box.parentNode.replaceChild(src,box);
    if(dur(a)) fade(src,true);
    arm(src);
    return src;
  }

  /* pantallas */
  function show(id,a){
    var s=B.screens[id];if(!s)return;
    timers.forEach(clearTimeout);timers=[];
    while(ovs.length)closeOv(true);
    cur=id;stage.innerHTML=s.html;fit();
    var root=stage.firstElementChild; if(dur(a))fade(root,true);
    document.body.style.background=bgOf(root);
    arm(root);
  }
  function bgOf(el){var b=el&&el.style.background;var m=b&&/#[0-9a-f]{6}|rgba?\([^)]*\)/i.exec(b);return m?m[0]:'#F1F2F4'}

  /* overlays */
  function openOv(id,a){
    var o=B.overlays[id]||B.variants[id];if(!o)return;
    var lay=document.createElement('div');lay.className='ovl';
    var bg=o.bg&&o.bg.type==='SOLID_COLOR'&&o.bg.color;
    if(bg)lay.style.background='rgba('+Math.round(bg.r*255)+','+Math.round(bg.g*255)+','+Math.round(bg.b*255)+','+(bg.a==null?1:bg.a)+')';
    var el=html(o.html);el.style.left='0px';el.style.top='0px';
    var box=document.createElement('div');box.className='ovb';box.style.width=o.w+'px';box.style.height=o.h+'px';
    var p=a&&a.overlayRelativePosition;
    if(o.pos==='MANUAL'&&p){box.style.left=p.x+'px';box.style.top=p.y+'px';}
    else{box.style.left=((1920-o.w)/2)+'px';box.style.top=((1080-o.h)/2)+'px';}
    box.appendChild(el);lay.appendChild(box);stage.appendChild(lay);
    if(o.close!=='NONE')lay.addEventListener('click',function(e){if(!box.contains(e.target))closeOv()});
    ovs.push(lay);fade(lay,true);arm(el);
  }
  function closeOv(now){var l=ovs.pop();if(!l)return;if(now)return l.remove();fade(l,false);setTimeout(function(){l.remove()},T)}

  /* ---------- disparadores ---------- */
  function list(el,type){var r=B.inter[el.getAttribute('data-id')]||[];return r.filter(function(x){return x.trigger.type===type})}
  function fire(el,type,ev){var r=list(el,type);r.forEach(function(x){(x.actions||[]).forEach(function(a){run(a,el,ev)})});return r.length>0}
  // el nodo más profundo con esa interacción gana, como en Figma
  function find(t,type){
    while(t&&t!==document){if(t.getAttribute&&t.getAttribute('data-id')&&list(t,type).length)return t;t=t.parentNode}
    return null;
  }
  function arm(root){
    // AFTER_TIMEOUT: corre cuando el elemento aparece
    var els=[root].concat([].slice.call(root.querySelectorAll('[data-id]')));
    els.forEach(function(el){
      list(el,'AFTER_TIMEOUT').forEach(function(x){
        timers.push(setTimeout(function(){if(el.isConnected)(x.actions||[]).forEach(function(a){run(a,el)})},Math.max(1,(x.trigger.timeout||0)*1000)));
      });
    });
    // clic posible: cursor de mano
    els.forEach(function(el){if(list(el,'ON_CLICK').some(function(x){return (x.actions||[]).some(Boolean)}))el.style.cursor='pointer'});
  }
  stage.addEventListener('click',function(e){var el=find(e.target,'ON_CLICK');if(el){e.stopPropagation();fire(el,'ON_CLICK',e)}});
  stage.addEventListener('mousedown',function(e){var el=find(e.target,'MOUSE_DOWN');if(el)fire(el,'MOUSE_DOWN',e)});
  stage.addEventListener('mouseup',function(e){var el=find(e.target,'MOUSE_UP');if(el)fire(el,'MOUSE_UP',e)});
  // hover: ON_HOVER vuelve al estado anterior al salir; MOUSE_ENTER no
  var hov=null;
  stage.addEventListener('mouseover',function(e){
    var el=find(e.target,'MOUSE_ENTER');if(el&&el!==e.relatedTarget&&!el.contains(e.relatedTarget))fire(el,'MOUSE_ENTER',e);
    var h=find(e.target,'ON_HOVER');
    if(h&&(!hov||!hov.el.isConnected||!(hov.el===h||hov.el.contains(h)))){
      endHover();
      var box=h.closest('[data-c]'),before=box;
      var acts=[];list(h,'ON_HOVER').forEach(function(x){acts=acts.concat(x.actions||[])});
      var swapped=null;acts.forEach(function(a){if(a&&a.navigation==='CHANGE_TO'){swapped=change(h,a.destinationId,a)||swapped}else run(a,h,e)});
      if(swapped)hov={el:swapped,orig:before};
    }
  });
  stage.addEventListener('mouseout',function(e){if(hov&&hov.el.isConnected&&!hov.el.contains(e.relatedTarget))endHover()});
  function endHover(){if(!hov)return;var h=hov;hov=null;if(h.el.isConnected){h.orig.style.opacity='';h.el.parentNode.replaceChild(h.orig,h.el);}}
  stage.addEventListener('mouseleave',function(e){var el=find(e.target,'MOUSE_LEAVE');if(el)fire(el,'MOUSE_LEAVE',e)});

  /* toques: en pantallas táctiles el hover no existe; el clic basta */
  show(B.start);
})();
