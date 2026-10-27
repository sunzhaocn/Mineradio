'use strict';

(function () {
  var bridge = window.desktopWindow;
  if (!bridge || typeof bridge.exportVisualVideo !== 'function') return;
  var mask, title, presetSelect, resolution, fps, status, progress, start, cancel, badge;
  var song, current, saved, preparing=false, serial=0, requestController, state={status:'idle',progress:0};
  function busy() { return preparing || ['preparing','rendering','encoding','canceling'].includes(state.status); }
  function render(value) {
    if(value&&value.status)state=value;
    if(!mask)return;
    start.disabled=busy();presetSelect.disabled=busy();resolution.disabled=busy();fps.disabled=busy();
    cancel.hidden=!busy();progress.value=Number(state.progress)||0;
    var labels={preparing:'正在分析音频并加载预设…',rendering:'正在生成视频画面 ',encoding:'正在完成视频文件…',
      completed:'视频已保存：'+(state.fileName||''),canceled:'已取消导出',canceling:'正在取消…',error:state.error||'视频导出失败'};
    status.textContent=preparing?'正在读取音频、歌词与预设素材…':labels[state.status]||'导出不会改变当前播放，也不会包含播放器按钮。';
    if(state.status==='rendering')status.textContent+=Math.floor(state.progress||0)+'% · '+Math.ceil(state.duration||0)+' 秒';
    badge.hidden=!busy();badge.textContent='视频导出 '+Math.floor(state.progress||0)+'%';
    start.textContent=busy()?'正在导出…':'选择位置并导出';
  }
  function create() {
    if(mask)return;
    var style=document.createElement('style');style.textContent=`
      #video-export-modal .modal{width:min(520px,calc(100vw - 32px));padding:24px}
      #video-export-modal label{display:block;margin:16px 0 6px}
      #video-export-modal select{width:100%;padding:10px;background:#161b24;color:#eee;border:1px solid #ffffff30;border-radius:10px}
      #video-export-modal progress{width:100%;height:12px;margin:18px 0 8px;accent-color:#b7ead3}
      #video-export-modal .video-export-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
      #video-export-badge{position:fixed;right:16px;bottom:116px;z-index:220;padding:12px 18px;border:1px solid #ffffff30;border-radius:16px;background:#172126;color:#b7ead3}
    `;document.head.append(style);
    mask=document.createElement('div');mask.id='video-export-modal';mask.className='modal-mask';
    var panel=document.createElement('section');panel.className='modal';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','导出预设视频');
    title=document.createElement('h2');title.textContent='导出预设视频';panel.append(title);
    function choice(caption,options){var label=document.createElement('label');label.textContent=caption;var input=document.createElement('select');input.id='video-export-choice-'+panel.querySelectorAll('select').length;label.htmlFor=input.id;
      options.forEach(function(item){var option=document.createElement('option');option.value=item[0];option.textContent=item[1];input.append(option);});panel.append(label,input);return input;}
    presetSelect=choice('视觉预设',[]);resolution=choice('画面清晰度',[['1080','高清 · 1920×1080'],['720','流畅 · 1280×720']]);fps=choice('流畅度',[['30','30 帧/秒'],['60','60 帧/秒']]);
    progress=document.createElement('progress');progress.max=100;progress.value=0;panel.append(progress);
    status=document.createElement('p');status.setAttribute('role','status');panel.append(status);
    var actions=document.createElement('div');actions.className='video-export-actions';
    function button(text,callback){var node=document.createElement('button');node.type='button';node.className='modal-btn';node.textContent=text;node.onclick=callback;actions.append(node);return node;}
    start=button('选择位置并导出',function(){begin().catch(function(error){if(state.status==='canceled')return;preparing=false;render({status:'error',error:['AbortError','TimeoutError'].includes(error.name)?'下载中断或超时，请重试':error.message,progress:0});});});
    cancel=button('取消导出',function(){serial++;if(requestController)requestController.abort();if(preparing){preparing=false;render({status:'canceled',progress:0});}else bridge.cancelVisualVideoExport().then(render);});
    button('收起',function(){closeGsapModal(mask);});panel.append(actions);mask.append(panel);document.body.append(mask);
    badge=document.createElement('button');badge.id='video-export-badge';badge.type='button';badge.hidden=true;
    badge.onclick=function(){openGsapModal(mask);};document.body.append(badge);
  }
  async function cover(selected,signal){
    var src=typeof songCoverSrc==='function'?songCoverSrc(selected,600):selected.cover;
    if(!src)return '';
    if(!/^(data:|blob:|mineradio-local:|\/)/.test(src))src='/api/cover?url='+encodeURIComponent(src);
    try{var response=await fetch(src,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)}),blob=await response.blob();
      if(!response.ok||blob.size>8*1024*1024||!/^image\/(png|jpeg|webp|gif)$/.test(blob.type))return '';
      return await new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=reject;reader.readAsDataURL(blob);});
    }catch(_){return '';}
  }
  async function movie(selected,preset,signal){
    if(preset.snapshot.preset!==13)return null;
    var provider=selected.originProvider||normalizePlaybackProvider(songProviderKey(selected));
    if(!['netease','qq','kugou','qishui'].includes(provider))return null;
    var id=selected.originId||selected.mid||selected.hash||selected.providerSongId||selected.id;
    if(window.mineradioMediaCache) {
      var origin={provider:provider,source:provider,id:id,name:selected.name||'',artist:selected.artist||''};
      if(provider==='qq')origin.mid=id;if(provider==='kugou')origin.hash=id;
      var cached=await mineradioMediaCache.read(origin).catch(function(){return null;});
      if(cached&&cached.mv instanceof Blob) {
        if(cached.mv.size>512*1024*1024)throw new Error('MV 超出导出大小限制');
        return new Uint8Array(await cached.mv.arrayBuffer());
      }
    }
    var params=new URLSearchParams({provider:provider,id:String(id),title:selected.name||'',artist:selected.artist||''});
    var info=await apiJson('/api/mv?'+params,{timeoutMs:65000,signal:signal});if(!info.available){showToast('此曲暂无 MV，将使用已设置的回退预设生成视频');return null;}
    var url='/api/video?'+params;
    var response=await fetch(url,{headers:window.localMusicCredentials?localMusicCredentials.headers(url):{},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000)});
    if(!response.ok||/json/.test(response.headers.get('content-type')||''))throw new Error('MV 素材暂时无法读取');
    var blob=await response.blob();if(blob.size>512*1024*1024)throw new Error('MV 超出导出大小限制');
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function begin(){
    if(busy())return;
    var selected=Object.assign({},song),preset=JSON.parse(JSON.stringify(presetSelect.value==='saved'?saved:current)),token=++serial;
    if (preset.resources && preset.resources.externalProject && preset.resources.externalProject.active)
      throw new Error('外部 Wallpaper Engine 项目暂不支持离线视频导出，请使用内置视觉预设');
    preparing=true;state={status:'idle',progress:0};render();
    requestController=new AbortController();var signal=requestController.signal;
    var coverTask=presetSelect.value==='current'&&preset.resources&&preset.resources.cover?Promise.resolve(preset.resources.cover.data):cover(selected,signal);
    var results=await Promise.all([mineradioTrackExports.audioFile(selected,undefined,signal),mineradioTrackExports.lyric(selected).catch(function(){return '';}),coverTask,movie(selected,preset,signal)]);
    if(token!==serial)return;
    var audio=new Uint8Array(await results[0].blob.arrayBuffer());if(token!==serial)return;
    var height=Number(resolution.value),width=height===1080?1920:1280;
    var response=await bridge.exportVisualVideo({audio:audio,lyric:results[1],cover:results[2]||(preset.resources&&preset.resources.cover&&preset.resources.cover.data)||'',video:results[3],preset:preset,
      song:{name:selected.name||selected.title||'本地音乐',artist:selected.artist||''},width:width,height:height,fps:Number(fps.value),
      name:mineradioTrackExports.filename(selected,' - '+preset.name+'.mp4')});
    preparing=false;requestController=null;
    if(!response||!response.ok){if(response&&response.canceled)return render({status:'canceled',progress:0});throw new Error(response&&response.error||'无法开始导出');}
    render(await bridge.getVisualVideoExportState());
  }
  window.mineradioVideoExport={open:async function(selected){
    create();if(!busy()){
      var token=++serial;preparing=true;
      song=Object.assign({},selected);title.textContent='导出视频 · '+(song.name||'本地音乐');
      render();openGsapModal(mask);
      var values;
      try { values=await Promise.all([mineradioTrackExports.forSong(song),mineradioTrackExports.recipe(song)]); }
      catch(error){if(token!==serial)return;preparing=false;render({status:'error',error:error.message,progress:0});return;}
      current=values[0];saved=values[1];
      if(token!==serial)return;preparing=false;
      presetSelect.replaceChildren();[['current','当前预设 · '+current.name],saved&&['saved','此曲已保存 · '+saved.name]].filter(Boolean).forEach(function(value){
        var option=document.createElement('option');option.value=value[0];option.textContent=value[1];presetSelect.append(option);});
      state={status:'idle',progress:0};render();return;
    }render();openGsapModal(mask);
  }};
  bridge.onVisualVideoExportState(function(value){state=value;render();});
  window.addEventListener('mineradio:ready',function(){bridge.getVisualVideoExportState().then(function(value){
    state=value;if(busy())create();render();
  }).catch(function(){});},{once:true});
})();
