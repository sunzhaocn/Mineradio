'use strict';
// A private view of this QR session's official verification page. The person
// performs every click, drag and text entry; no challenge is solved in code.
(function(){
  var box,image,input,mask,timer=0,active=false,request,current,points=[],chain=Promise.resolve();
  function stop(){active=false;clearTimeout(timer);if(box)box.hidden=true;if(mask)mask.classList.remove('remote-verification-active');}
  async function frame(){
    clearTimeout(timer);
    if(!active||!current()){stop();return;}
    try{
      var result=await request();
      if(active&&current()&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(result.image||''))image.src=result.image;
    }catch(_){ /* Polling the login status decides whether the session ended. */ }
    if(active)timer=setTimeout(frame,1800);
  }
  function send(value){
    chain=chain.catch(function(){}).then(async function(){if(active&&current())await request(JSON.stringify(value));}).then(frame);
  }
  function button(text,action){var b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b;}
  function point(event){var r=image.getBoundingClientRect();return [Math.max(0,Math.min(979,(event.clientX-r.left)*980/r.width)),Math.max(0,Math.min(759,(event.clientY-r.top)*760/r.height))];}
  function open(host,call,isCurrent){
    if(active)return;
    request=call;current=isCurrent;mask=host.closest('.modal-mask');
    if(!box){
      box=document.createElement('section');box.className='local-auth-verification';
      var title=document.createElement('p');title.textContent='汽水官方安全验证 · 请亲自点击或拖动下方画面完成验证';
      image=document.createElement('img');image.alt='本次汽水官方安全验证界面';image.draggable=false;
      image.onpointerdown=function(e){e.preventDefault();points=[point(e)];image.setPointerCapture(e.pointerId);};
      image.onpointermove=function(e){if(!points.length||points.length>=47)return;var p=point(e),last=points[points.length-1];if(Math.hypot(p[0]-last[0],p[1]-last[1])>4)points.push(p);};
      image.onpointerup=function(e){if(!points.length)return;var path=points;points=[];path.push(point(e));var p=path[0],end=path[path.length-1];send(Math.hypot(p[0]-end[0],p[1]-end[1])<5?{action:'tap',x:end[0],y:end[1]}:{action:'drag',points:path});};
      image.onpointercancel=function(){points=[];};
      var tools=document.createElement('div');tools.className='local-auth-verification-tools';
      input=document.createElement('input');input.type='password';input.autocomplete='off';input.maxLength=128;input.placeholder='先点画面中的输入框，再在这里输入';
      tools.append(input,button('发送输入',function(){var value=input.value;input.value='';if(value)send({action:'text',text:value});}));
      [['Enter','确认'],['Backspace','退格'],['Tab','下一项']].forEach(function(row){tools.append(button(row[1],function(){send({action:'key',key:row[0]});}));});
      box.append(title,image,tools);host.append(box);
    }
    active=true;box.hidden=false;if(mask)mask.classList.add('remote-verification-active');frame();
  }
  window.mineradioQishuiVerification={open:open,stop:stop};
  window.addEventListener('pagehide',stop);
})();
