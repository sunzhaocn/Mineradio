'use strict';

/* 当前音源的下载小菜单：桌面和触屏都点击展开，点音质立即下载。
 * 只请求下载清单和普通文件接口，不改变播放来源、进度或播放音质偏好。
 */
(function () {
  'use strict';
  var names={netease:'网易云',qq:'QQ 音乐',kugou:'酷狗',qishui:'汽水'};
  var element=document.createElement('div');element.id='web-download-menu';
  element.className='control-source-switcher web-anchored-menu web-download-menu';element.hidden=true;
  element.setAttribute('role','menu');element.setAttribute('aria-label','选择下载音质');
  var header=document.createElement('div');header.className='control-source-switcher-head web-action-menu-head';
  var title=document.createElement('span');title.textContent='下载音质';var source=document.createElement('span');header.append(title,source);
  var songTitle=document.createElement('p');songTitle.className='web-action-song';
  var status=document.createElement('p');status.className='web-download-status';status.setAttribute('role','status');
  var list=document.createElement('div');list.className='web-download-options';
  element.append(header,songTitle,status,list);document.body.append(element);
  var generation=0,target=null,options=[];
  var menu=window.webAnchoredMenus.create({element:element,onClose:function() { generation+=1; }});

  function provider(song) { return normalizePlaybackProvider(songProviderKey(song)); }
  function id(song) { return song && (song.mid || song.songmid || song.hash || song.providerSongId || song.id) || ''; }
  function usable(item) { return item.downloadable===true; }
  function detail(item) {
    var parts=[];
    if (item.encode) parts.push(String(item.encode).toUpperCase());
    if (item.bitrate) parts.push(item.bitrate+' kbps');
    if (item.sample_rate) parts.push(Math.round(Number(item.sample_rate)/100)/10+' kHz');
    if (item.filesize) parts.push((item.filesize/1048576).toFixed(1)+' MB');
    if (item.vip_required) parts.push('VIP');
    if (item.kind && item.kind.indexOf('试听')>=0) parts.push('试听');
    if (!usable(item)) parts.push(item.download_reason==='protected_media' ? '请使用官方客户端下载' : '暂不可下载');
    return parts.join(' · ');
  }
  function lyricUrl(song) {
    return '/api/' + (song.provider === 'netease' ? '' : song.provider + '/') + 'lyric?id=' + encodeURIComponent(song.id);
  }
  async function lyricText(song) {
    if (song.song.lyric) return song.song.lyric;
    var data = await apiJson(lyricUrl(song), {timeoutMs:25000});
    var value = data && (data.lyric || data.lrc && (data.lrc.lyric || data.lrc));
    return typeof value === 'string' ? value : '';
  }
  function saveFile(blob, name) {
    var url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download=name;a.click();
    setTimeout(function(){URL.revokeObjectURL(url);},60000);
  }
  function filename(song, suffix) {
    return (song.name + (song.song.artist ? ' - ' + song.song.artist : '')).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,150) + suffix;
  }
  async function downloadLyric() {
    var selected = target; menu.close('lyric');
    try {
      var text=await lyricText(selected);
      if(!text.trim())return showToast('当前歌曲暂无可下载歌词');
      if(window.browserLocalMusic) await browserLocalMusic.saveTrackLyric(Object.assign({},selected.song,{provider:selected.provider}),text);
      if (!window.mineradioRemoteApp) saveFile(new Blob(['\ufeff'+text],{type:'text/plain;charset=utf-8'}),filename(selected,'.lrc'));
      showToast(window.mineradioRemoteApp ? '歌词已保存到本地' : '已下载歌词');
    }catch(_){showToast('歌词获取失败，请稍后重试');}
  }
  async function localCover(song) {
    var cover = typeof songCoverSrc === 'function' ? songCoverSrc(song, 400) : song.cover;
    if (!cover) return '';
    var controller=new AbortController(), timer=setTimeout(function(){controller.abort();},15000);
    try {
      var url = /^(blob:|data:|mineradio-local:|\/)/.test(cover) ? cover : '/api/cover?url='+encodeURIComponent(cover);
      var response=await fetch(url,{signal:controller.signal}),blob=await response.blob();
      if(!response.ok || blob.size>2*1024*1024 || !/^image\//.test(blob.type))return '';
      return await new Promise(function(resolve){var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=function(){resolve('');};reader.readAsDataURL(blob);});
    }catch(_){return '';}
    finally{clearTimeout(timer);}
  }
  var saving = new Set();
  function browserDownload(selected, key) {
    var frame=document.createElement('iframe');frame.hidden=true;frame.title='音乐文件下载';frame.setAttribute('aria-hidden','true');
    var url='/api/download?provider='+encodeURIComponent(selected.provider)+'&id='+encodeURIComponent(selected.id)+'&quality='+encodeURIComponent(key);
    if(window.__mineradioIOS && typeof window.mineradioIOSDownload==='function') {
      menu.close('select');
      return window.mineradioIOSDownload(url)
        .catch(function(error){showToast(error.message || '音乐文件导出失败');});
    }
    frame.src=window.localMusicCredentials?localMusicCredentials.url(url,selected.provider):url;
    frame.onload=function(){try{var text=frame.contentDocument&&frame.contentDocument.body&&frame.contentDocument.body.textContent;
      if(!text||!text.trim())return;var result=JSON.parse(text);if(result.message||result.error)showToast(result.message||result.error);frame.remove();}catch(_){}};
    document.body.append(frame);menu.close('select');showToast('已请求下载 '+selected.name+' · '+names[selected.provider]);
  }
  async function download(key) {
    if (!target || !menu.isOpen()) return;
    var item=options.find(function(option){return option.key===key;});
    if ((key==='auto' && !options.some(usable)) || (key!=='auto' && (!item || !usable(item))))return;
    var selected=target,identity=selected.provider+':'+selected.id+':'+key;
    if (!window.browserLocalMusic) return browserDownload(selected, key);
    if(saving.has(identity))return showToast('这首歌正在保存');
    saving.add(identity);menu.close('select');showToast('正在下载并保存到本地曲库…');
    try {
      var url='/api/download?provider='+encodeURIComponent(selected.provider)+'&id='+encodeURIComponent(selected.id)+'&quality='+encodeURIComponent(key);
      var headers=window.localMusicCredentials ? window.localMusicCredentials.headers(url) : {};
      var controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},180000);
      var response,blob;
      try {
        response=await fetch(url,{headers:headers,signal:controller.signal});
        if(response.status===206 || response.headers.get('content-range'))throw new Error('下载不完整，请重试');
        if(!response.ok || /json/i.test(response.headers.get('content-type')||'')){
          var error=await response.json();throw new Error(error.message||'当前音源暂不可下载');
        }
        var length=Number(response.headers.get('content-length'));
        if(length>512*1024*1024)throw new Error('文件超出本地保存大小限制');
        blob=await response.blob();
        if(!blob.size || blob.size>512*1024*1024 || length>0&&blob.size!==length)throw new Error('音乐文件未完整保存，请重试');
      }finally{clearTimeout(timeout);}
      var disposition=response.headers.get('content-disposition')||'', match=disposition.match(/filename\*=UTF-8''([^;]+)/i);
      var name=match ? decodeURIComponent(match[1]) : filename(selected,'.'+(item&&item.encode||'mp3'));
      var extras=await Promise.all([lyricText(selected).catch(function(){return '';}),localCover(selected.song)]);
      var file=new File([blob],name,{type:blob.type,lastModified:0});
      var result=await browserLocalMusic.saveDownloadedTrack(file,selected.song,extras[0],extras[1]);
      if(typeof persistentLocalLibraryTracks!=='undefined')persistentLocalLibraryTracks=result.tracks;
      window.dispatchEvent(new Event('mineradio:local-library-changed'));
      if(typeof renderHomeDashboard==='function')renderHomeDashboard();
      // Browsers also receive the ordinary file. Installed clients keep the
      // automatic app-local copy, which is visible in their local music library.
      if(!window.mineradioRemoteApp && !window.__mineradioAndroid && !window.__mineradioIOS && !(window.desktopWindow&&desktopWindow.isDesktop))saveFile(blob,name);
      showToast('已保存音乐'+(extras[0]?'和歌词':'（暂无歌词）')+'，可从本地音乐离线播放');
    }catch(error){showToast(error.name==='AbortError'?'下载超时，请重试':error.message||'本地保存失败，请检查存储空间');}
    finally{saving.delete(identity);}
  }
  function option(key,label,description,disabled) {
    var row=document.createElement('button');row.type='button';row.className='web-download-option web-action-option';
    row.dataset.quality=key;row.disabled=disabled;row.setAttribute('role','menuitem');
    var name=document.createElement('span'),text=document.createElement('small');
    name.textContent=label;text.textContent=description;row.append(name,text);list.append(row);
    row.onclick=function() { download(key); };
  }
  function render() {
    list.replaceChildren();
    if (options.some(usable)) option('auto','自动 · 最高可下载','从 '+names[target.provider]+' 选择',false);
    options.filter(usable).forEach(function(item) { option(item.key,item.quality || item.key,detail(item),false); });
    var lyric=document.createElement('button');lyric.type='button';lyric.className='web-download-option web-action-option';lyric.setAttribute('role','menuitem');lyric.textContent='下载歌词 · LRC';lyric.onclick=downloadLyric;list.append(lyric);
    menu.reposition();
  }
  async function open(song,event,anchor) {
    if (event) event.stopPropagation();
    if (!song || !id(song)) { menu.close('empty');return showToast('请先选择歌曲'); }
    var p=provider(song);
    if (!names[p]) { menu.close('unsupported');return showToast('当前音源暂不支持下载'); }
    anchor=anchor || event && event.currentTarget || document.getElementById('web-download-btn');
    if (typeof closeControlSourceSwitcher==='function') closeControlSourceSwitcher();
    menu.open(anchor);
    var token=++generation;
    // 歌曲和平台固定到本次打开，不会误用异步完成后正在播放的另一首歌。
    target={provider:p,id:String(id(song)),name:song.name || song.title || '当前歌曲',song:Object.assign({},song)};
    options=[];list.replaceChildren();
    songTitle.textContent=target.name+(song.artist ? ' · '+song.artist:'');songTitle.title=songTitle.textContent;
    source.className='tag-source '+p;source.textContent=names[p];
    status.textContent='正在获取音质…';render();
    try {
      var data=await apiJson('/api/download/qualities?provider='+encodeURIComponent(p)+'&id='+encodeURIComponent(target.id),{timeoutMs:95000});
      if (token!==generation || !menu.isOpen()) return;
      if (!data || !Array.isArray(data.qualities)) throw new Error(data && (data.message || data.error) || '音质加载失败');
      options=data.qualities;
      status.textContent=data.message || (options.some(usable) ? '点击音质即可下载' : '当前歌曲暂无可下载音质');render();
    } catch (error) {
      if (token!==generation || !menu.isOpen()) return;
      status.textContent=error.name==='AbortError' ? '加载超时，请关闭菜单后重试' : error.message || '音质加载失败';render();
    }
  }
  window.openWebSongDownload=function(index,event) { return open(playlist && playlist[index],event); };
  window.openWebCurrentDownload=function(event) { return open(playQueue && currentIdx>=0 ? playQueue[currentIdx] : null,event); };
  var playerButton=document.getElementById('web-download-btn');
  if (playerButton) menu.bind(playerButton,{onOpen:function(anchor,event) {
    return open(playQueue && currentIdx>=0 ? playQueue[currentIdx] : null,event,anchor);
  }});
  window.webAnchoredMenus.bindDelegated('.web-song-download-button',function(anchor,event) {
    return {menu:menu,onOpen:function() { return open(playlist && playlist[Number(anchor.dataset.webDownloadIndex)],event,anchor); }};
  });
}());
