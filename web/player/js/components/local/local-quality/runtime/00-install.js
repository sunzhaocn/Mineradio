'use strict';

/* 四平台音质与歌曲标签适配。
 * 菜单来源是当前歌曲的 qualities，不使用原作固定的 Hi-Res/母带占位菜单。
 * 保存的是平台音质偏好；换歌按当前曲目自动降级，按钮始终显示实际播放档位。
 */
(function () {
  'use strict';
  var STORE = 'mineradio-web-quality-v2';
  var names = {netease:'网易云', qq:'QQ 音乐', kugou:'酷狗', qishui:'汽水'};
  var catalogs = new Map(), pending = new Map(), failures = new Map();
  var qualityOrder={netease:['jymaster','hires','lossless','exhigh','higher','standard'],
    qq:['jymaster','hires','flac','320','128','aac'],kugou:['jymaster','hires','sq','320','high','128'],
    qishui:['hi_res','lossless','spatial','highest','higher','medium']};
  var previewSong = null, switching = false;
  // 与音源切换器相同：桌面和触屏都点击按钮展开，点音质切换，列表独立滚动。
  var popover=document.querySelector('.quality-popover'), panelTrigger=null;
  popover.id='web-quality-popover';popover.classList.add('control-source-switcher','web-anchored-menu');
  var qualityMenu=window.webAnchoredMenus.create({element:popover,onClose:function() {
    document.getElementById('quality-control').classList.remove('open');
    document.getElementById('quality-btn').setAttribute('aria-expanded','false');
    previewSong=null;
  }});
  function showPanel(open,trigger) {
    if (open) {
      panelTrigger=trigger || document.getElementById('quality-btn');
      if (typeof closeControlSourceSwitcher==='function') closeControlSourceSwitcher();
      qualityMenu.open(panelTrigger);
    } else qualityMenu.close('select');
    document.getElementById('quality-control').classList.toggle('open',open);
    document.getElementById('quality-btn').setAttribute('aria-expanded',open ? 'true':'false');
  }
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) {}
  playbackQualityPrefs = Object.assign({netease:'auto', qq:'auto', kugou:'auto', qishui:'auto'}, prefs);

  function currentSong() { return playQueue && currentIdx >= 0 ? playQueue[currentIdx] : null; }
  function targetSong() { return previewSong || currentSong(); }
  function provider(song) { return normalizePlaybackProvider(songProviderKey(song)); }
  function id(song) { return song && (song.mid || song.songmid || song.hash || song.providerSongId || song.id) || ''; }
  function identity(song) { return song ? provider(song) + ':' + id(song) : ''; }
  function prefix(song) { var p=provider(song); return '/api' + (p==='netease' ? '' : '/'+p); }
  function query(song) { return '?id=' + encodeURIComponent(id(song)); }
  function itemFor(song, value) {
    var data = catalogs.get(identity(song));
    return data && data.qualities.find(function(q) { return q.key===value; });
  }
  function playable(item) { return item.available===true; }
  function qualityLabel(song,value) {
    if (value==='auto' || value==='best') return '自动 · 最高可用';
    var item=itemFor(song,value);
    return item ? item.quality : String(value || '自动');
  }
  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(playbackQualityPrefs)); } catch (_) {}
  }

  // 保留平台原生 key，higher / high / aac / medium 等不会被统一成其它档位。
  normalizePlaybackQualityForProvider = function(value, p) {
    value=String(value || 'auto').toLowerCase();
    var aliases = {netease:{'128':'standard','192':'higher','320':'exhigh',flac:'lossless',sq:'lossless'},
      qq:{standard:'128',exhigh:'320',lossless:'flac',sq:'flac'},
      kugou:{standard:'128',exhigh:'320',lossless:'sq',flac:'sq'},
      qishui:{standard:'medium','128':'higher','320':'highest',flac:'lossless',sq:'lossless'}};
    return (aliases[p] || {})[value] || value;
  };
  getProviderPlaybackQuality = function(p) { return normalizePlaybackQualityForProvider(playbackQualityPrefs[p] || 'auto',p); };
  setProviderPlaybackQuality = function(p,value) { playbackQualityPrefs[p]=value; playbackQuality=value; persist(); };
  // 各档可用状态由本次接口结果决定，不使用旧的静态音质排名或账号弹窗锁定。
  playbackQualityAboveCap = function() { return false; };
  playbackQualityWasDowngraded = function(requested,resolved,p) {
    var order=qualityOrder[p] || [], want=order.indexOf(normalizePlaybackQualityForProvider(requested,p));
    var actual=order.indexOf(normalizePlaybackQualityForProvider(resolved,p));
    return want>=0 && actual>want;
  };
  playbackQualityCapValue = function() { return ''; };
  effectivePlaybackQualityForSong = function(song,p,requested) { return requested || getProviderPlaybackQuality(p); };
  playbackQualityLabel = function(value,p) {
    if (value==='auto' || value==='best') return '自动 · 最高可用';
    var song=targetSong(), item=song && provider(song)===p && itemFor(song,value);
    return item ? item.quality : String(value || '自动');
  };
  playbackQualityShortLabel = playbackQualityLabel;

  function remember(song, data) {
    if (!song || !Array.isArray(data.qualities)) return;
    var previous=catalogs.get(identity(song)), partial=data.qualitiesComplete===false;
    if (partial && previous && previous.complete!==false) {
      var updates=new Map(data.qualities.map(function(item) { return [item.key,item]; }));
      catalogs.set(identity(song), {qualities:previous.qualities.map(function(item) { return updates.get(item.key) || item; }),
        at:previous.at,complete:true});
    } else catalogs.set(identity(song), {qualities:data.qualities, at:Date.now(),complete:!partial});
    failures.delete(identity(song));
    while (catalogs.size > 80) catalogs.delete(catalogs.keys().next().value);
    while (failures.size > 80) failures.delete(failures.keys().next().value);
    // 封面由播放流程写入并加载；提前合并会让它误判为已有封面，跳过补图。
    ['vipRequired','paid','qualityVip','isOriginal','badges'].forEach(function(k) {
      if (data[k] !== undefined && data[k] !== null && data[k] !== '') song[k]=data[k];
    });
    if (identity(song)===identity(targetSong())) updatePlaybackQualityUi();
  }
  var originalApiJson=apiJson;
  apiJson=async function(url,opts) {
    opts=Object.assign({},opts);
    // 点击菜单先精确验证；普通换歌与后台预载都把档位当作偏好，可向下选择。
    if (typeof url==='string' && /^\/api\/(?:qq\/|kugou\/|qishui\/)?song\/url\?/.test(url)) {
      if (!opts.exactQuality && !/[?&]allowQualityFallback=/.test(url)) url+='&allowQualityFallback=1';
    }
    delete opts.exactQuality;
    // 完整音质只在打开菜单时加载；播放和歌词沿用调用方的短预算与取消信号。
    if (typeof url==='string' && /^\/api\/(?:qq\/|kugou\/|qishui\/)?qualities\?/.test(url)) {
      opts=Object.assign({},opts,{timeoutMs:95000});
    }
    var data=await originalApiJson(url,opts);
    // 快速播放只返回必要档位，不能把它当成完整音质目录。
    if (typeof url==='string' && /\/song\/url\?/.test(url) && data && Array.isArray(data.qualities)) {
      var u=new URL(url,window.location.href), p=u.pathname.split('/')[2];
      p=['qq','kugou','qishui'].indexOf(p)>=0 ? p : 'netease';
      var key=u.searchParams.get('mid') || u.searchParams.get('hash') || u.searchParams.get('id');
      var song=(playQueue || []).find(function(s) { return provider(s)===p && String(id(s))===String(key); });
      if (song) remember(song,data);
    }
    return data;
  };
  function ensure(song,force) {
    if (!song || !id(song)) return Promise.resolve();
    var key=identity(song), cached=catalogs.get(key);
    if (!force && cached && cached.complete!==false && Date.now()-cached.at<120000) return Promise.resolve(cached);
    if (pending.has(key)) return pending.get(key);
    var task=apiJson(prefix(song)+'/qualities'+query(song),{timeoutMs:90000}).then(function(data) {
      if (!data || !Array.isArray(data.qualities)) throw new Error(data && (data.message || data.msg) || '音质信息加载失败');
      remember(song,data); return data;
    }).catch(function(error) {
      failures.set(key,error.name==='AbortError' ? '加载超时，请重试' : error.message || '音质信息加载失败');
    }).finally(function() {
      pending.delete(key); if (key===identity(targetSong())) updatePlaybackQualityUi();
    });
    pending.set(key,task); return task;
  }
  function description(item) {
    var parts=[];
    if (item.encode) parts.push(String(item.encode).toUpperCase());
    if (item.bitrate) parts.push(item.bitrate+' kbps');
    if (item.sample_rate) parts.push(Math.round(Number(item.sample_rate)/100)/10+' kHz');
    if (item.filesize) parts.push((item.filesize/1048576).toFixed(1)+' MB');
    if (item.vip_required) parts.push('VIP');
    if (item.kind && item.kind.indexOf('试听')>=0) parts.push('试听');
    parts.push(item.available ? '可播放' : item.encrypted ? '加密 · 暂不能播放' : '暂不可用');
    return parts.join(' · ');
  }
  function option(list,key,title,sub,disabled,selected) {
    var button=document.createElement('button'); button.type='button';button.className='quality-option web-action-option';
    button.dataset.quality=key; button.disabled=disabled;
    button.setAttribute('role','menuitemradio'); button.setAttribute('aria-checked',selected ? 'true':'false');
    button.classList.toggle('active',selected);
    var label=document.createElement('span'), detail=document.createElement('small');
    label.textContent=title; detail.textContent=sub;button.append(label,detail);
    button.onclick=function() { setPlaybackQuality(key); };list.append(button);
  }
  updatePlaybackQualityUi=function() {
    var song=targetSong(), list=document.getElementById('quality-option-list'), btn=document.getElementById('quality-btn');
    var label=document.getElementById('quality-btn-label'), p=provider(song), selected=getProviderPlaybackQuality(p);
    if (label) label.textContent=currentSong() && currentSong().nativePlaybackQuality
      ? qualityLabel(currentSong(),currentSong().nativePlaybackQuality) : '音质';
    if (!list) return;
    list.replaceChildren(); list.setAttribute('role','menu');list.setAttribute('aria-label','选择歌曲音质');
    var head=document.createElement('div');head.className='web-quality-head';
    head.textContent=song ? names[p]+' · '+(song.name || song.title || '当前歌曲') : '请先选择歌曲';list.append(head);
    head.title=head.textContent;
    if (btn) btn.title='选择音质';
    if (!song) return;
    var cached=catalogs.get(identity(song));
    if (!cached) {
      var message=document.createElement('p');message.className='web-quality-message';
      message.textContent=failures.get(identity(song)) || '正在获取这首歌的全部音质…';list.append(message);
      if (failures.has(identity(song))) {
        var retry=document.createElement('button');retry.className='quality-option';retry.textContent='重新加载';
        retry.onclick=function() { failures.delete(identity(song));ensure(song,true);updatePlaybackQualityUi(); };list.append(retry);
      }
      qualityMenu.reposition();return;
    }
    var available=cached.qualities.filter(playable);
    option(list,'auto','自动 · 最高可用','按当前歌曲实际可用音源选择',!available.length,selected==='auto');
    available.forEach(function(item) {
      option(list,item.key,item.quality,description(item),false,selected===item.key);
    });
    if (cached.complete===false) {
      var loading=document.createElement('p');loading.className='web-quality-message';
      loading.textContent=failures.get(identity(song)) || '正在补齐全部音质…';list.append(loading);
    }
    if (!available.length) {
      var empty=document.createElement('p');empty.className='web-quality-message';empty.textContent='当前歌曲暂无可播放音质';list.append(empty);
    }
    qualityMenu.reposition();
  };
  function openCurrentQuality(anchor) {
    previewSong=null;showPanel(true,anchor);updatePlaybackQualityUi();ensure(targetSong(),false);
  }
  function openSongQuality(song,anchor) {
    if (!song) return;
    showPanel(true,anchor);previewSong=song;updatePlaybackQualityUi();ensure(song,false);
  }
  toggleQualityPanel=function(event) {
    if (event) event.stopPropagation();
    var anchor=event && event.currentTarget || document.getElementById('quality-btn');
    if (qualityMenu.isOpen() && panelTrigger===anchor) return qualityMenu.close('toggle');
    openCurrentQuality(anchor);
  };
  window.openWebSongQuality=function(index,event) {
    if (event) event.stopPropagation();
    openSongQuality(playlist && playlist[index],event && event.currentTarget || document.getElementById('quality-btn'));
  };
  setPlaybackQuality=async function(value) {
    var song=targetSong();if (!song || switching) return;
    await ensure(song,false);
    if (switching || identity(song)!==identity(targetSong())) return;
    var item=itemFor(song,value), p=provider(song);
    var cached=catalogs.get(identity(song));
    if (value==='auto' ? !cached || !cached.qualities.some(playable) : !item || !playable(item))
      return showToast('这首歌的所选音质暂不可用');
    showPanel(false);
    if (identity(song)!==identity(currentSong()) || !audio || !audio.src) {
      setProviderPlaybackQuality(p,value);updatePlaybackQualityUi();return showToast('已选择音质，下次播放生效');
    }
    var resume=Number(audio.currentTime)||0, wasPaused=audio.paused;
    switching=true;showToast('正在切换音质…');
    try {
      var data=await apiJson(prefix(song)+'/song/url'+query(song)+'&quality='+encodeURIComponent(value),{timeoutMs:90000,exactQuality:true});
      if (!data.url) return showToast(data.message || '所选音质暂不可用，当前播放保持不变');
      // 获取成功后再切换，保留进度；暂停状态也能切换，完成后恢复暂停。
      var index=currentIdx;
      if (identity(song)!==identity(currentSong())) return;
      setProviderPlaybackQuality(p,value);
      await playQueueAt(index,{qualityOverride:value,qualitySwitch:true,resumeAt:resume,preserveHomeState:true,preResolvedPlaybackData:data});
      if (wasPaused && audio && identity(song)===identity(currentSong())) audio.pause();
    } catch (_) { showToast('切换失败，请重试'); }
    finally { switching=false;updatePlaybackQualityUi(); }
  };
  var originalTrackInfo=updateControlTrackInfo;
  updateControlTrackInfo=function(song) {
    originalTrackInfo(song);
    if (!qualityMenu.isOpen() || panelTrigger===document.getElementById('quality-btn')) previewSong=null;
    updatePlaybackQualityUi();
    if (qualityMenu.isOpen() && identity(song)===identity(targetSong())) ensure(song,false);
  };
  songVipTagHtml=function(song) {
    var allowed=['VIP','付费','高音质VIP','原唱','翻唱'];
    var badges=Array.isArray(song.badges) ? song.badges.filter(function(b) { return allowed.indexOf(b)>=0; }) : [];
    if (!badges.length && song.vipRequired) badges=['VIP'];
    return badges.map(function(b) { return '<span class="tag-vip web-song-badge'+(b==='原唱' || b==='翻唱' ? ' web-origin-badge':'')+'">'+escHtml(b)+'</span>'; }).join('');
  };
  var bound=false;
  bindQualityControl=function() {
    if (bound) return;bound=true;
    qualityMenu.bind(document.getElementById('quality-btn'),{onOpen:function(anchor) { openCurrentQuality(anchor); }});
    window.webAnchoredMenus.bindDelegated('.web-song-quality-button',function(anchor) {
      return {menu:qualityMenu,onOpen:function() { openSongQuality(playlist && playlist[Number(anchor.dataset.webQualityIndex)],anchor); }};
    });
    updatePlaybackQualityUi();
  };
  var originalSourceSwitcher=toggleControlSourceSwitcher;
  toggleControlSourceSwitcher=function() {
    window.webAnchoredMenus.closeAll('source-switch');return originalSourceSwitcher.apply(this,arguments);
  };
  function playbackDataForQuality(data,item,p,requested) {
    var native=item.key, legacy={flac:'lossless',sq:'lossless','320':'exhigh','128':'standard'};
    return Object.assign({},data,{url:item.url,provider:p,level:legacy[native] || native,
      nativeQuality:native,quality:native,requestedQuality:requested,br:(Number(item.bitrate) || 0)*1000,
      encrypted:!!item.encrypted,decryption_supported:!!item.decryption_supported,
      trial:String(item.kind || '').indexOf('试听')>=0,playable:true,reason:'',message:'',
      localExactQuality:false,qualityFallback:requested!=='auto' && requested!=='best'
        && normalizePlaybackQualityForProvider(requested,p)!==native});
  }
  // 无播放/队列副作用：媒体加载失败时可复用同次探测的其它档位，避免重新等整曲解析。
  window.resolvePlaybackDataWithQualityFallback=async function(song,opts) {
    opts=opts || {};
    function active() { return (!opts.signal || !opts.signal.aborted) && (!opts.isCurrent || opts.isCurrent()); }
    if (!song || !id(song) || !active()) return null;
    var p=provider(song), requested=normalizePlaybackQualityForProvider(opts.requestedQuality || getProviderPlaybackQuality(p),p);
    var data=opts.data || await apiJson(prefix(song)+'/song/url'+query(song)+'&quality='+encodeURIComponent(requested),
      {timeoutMs:20000,signal:opts.signal});
    if (!active() || !data) return null;
    var excludedQualities=(opts.excludedQualities || []).map(function(key) { return normalizePlaybackQualityForProvider(key,p); });
    var excludedUrls=opts.excludedUrls || [], order=qualityOrder[p] || [], ceiling=order.indexOf(requested);
    var excluded=function(item) { return excludedQualities.indexOf(item.key)>=0 || excludedUrls.indexOf(item.url)>=0; };
    if (data.url && !excluded({key:data.nativeQuality || data.quality || '',url:data.url})) return data;
    if (data.qualitiesComplete===false) {
      // A failed media URL needs only the next untried quality, never a full
      // catalog/lyric scan on the playback critical path.
      if (!data.url) return null;
      var failedRank=order.indexOf(data.nativeQuality || data.quality || '');
      var probeCeiling=Math.max(ceiling,failedRank);
      var candidates=order.filter(function(key,index) {
        return index>=probeCeiling && (requested==='auto' || requested==='best' || ceiling>=0)
          && excludedQualities.indexOf(key)<0;
      });
      for (var i=0;i<candidates.length && active();i++) {
        var candidate=candidates[i];
        if (excludedQualities.indexOf(candidate)>=0) continue;
        var probe=await apiJson(prefix(song)+'/song/url'+query(song)+'&quality='+encodeURIComponent(candidate)+'&allowQualityFallback=1',
          {timeoutMs:20000,signal:opts.signal});
        if (!active()) return null;
        if (!probe || !probe.url) return null;
        var native=probe.nativeQuality || probe.quality || candidate;
        if (excludedUrls.indexOf(probe.url)<0 && excludedQualities.indexOf(native)<0) {
          return Object.assign({},probe,{requestedQuality:requested,localExactQuality:false,
            qualityFallback:requested!=='auto' && requested!=='best' && native!==requested});
        }
        if (excludedQualities.indexOf(native)<0) excludedQualities.push(native);
      }
      return null;
    }
    var options=(data.qualities || []).filter(function(item) {
      if (!playable(item) || !item.url || excluded(item)) return false;
      var rank=order.indexOf(item.key);
      return requested==='auto' || requested==='best' || ceiling>=0 && rank>=ceiling;
    });
    // 保留服务端 auto 的排序策略（汽水优先无损）；显式偏好按档位从高到低回落。
    if (requested!=='auto' && requested!=='best') options.sort(function(a,b) { return order.indexOf(a.key)-order.indexOf(b.key); });
    else if (p==='qishui') options.sort(function(a,b) {
      var preferred=['lossless','hi_res','spatial','highest','higher','medium'];
      return preferred.indexOf(a.key)-preferred.indexOf(b.key);
    });
    return options.length ? playbackDataForQuality(data,options[0],p,requested) : null;
  };
  async function retryPlaybackQuality(song,data,index,token,opts) {
    opts=opts || {};
    if (!data || !Array.isArray(data.qualities) || token!==trackSwitchToken) return null;
    var p=provider(song), tried=(opts.nativeQualityTried || []).slice(), failedUrls=(opts.nativeQualityUrlsTried || []).slice();
    var failed=normalizePlaybackQualityForProvider(data.nativeQuality || data.quality || data.level,p);
    if (tried.indexOf(failed)<0) tried.push(failed);
    if (data.url && failedUrls.indexOf(data.url)<0) failedUrls.push(data.url);
    var requested=data.requestedQuality || opts.qualityOverride || getProviderPlaybackQuality(p);
    var next=await window.resolvePlaybackDataWithQualityFallback(song,{data:data,requestedQuality:requested,
      excludedQualities:tried,excludedUrls:failedUrls,signal:opts.playbackResolutionOwner && opts.playbackResolutionOwner.signal,
      isCurrent:function() { return token===trackSwitchToken; }});
    if (!next || token!==trackSwitchToken) return null;
    var retry=Object.assign({},opts);
    Object.keys(retry).forEach(function(key) { if (/^preloaded/.test(key) || key==='preResolvedPlaybackData') delete retry[key]; });
    ['nextTrackPreloadHandoff','albumGaplessHandoff','albumGaplessMixed','cuefieldAutoMix'].forEach(function(key) { delete retry[key]; });
    retry.qualityOverride=requested;
    retry.skipShuffleOrder=true;
    retry.preResolvedPlaybackData=next;
    retry.nativeQualityTried=tried;
    retry.nativeQualityUrlsTried=failedUrls;
    return await playQueueAt(index,retry)===true;
  }
  // 提供小而稳定的纯函数入口，便于验证动态档位不会合并或丢失。
  window.webQualityHelpers={description:description,normalize:normalizePlaybackQualityForProvider,retryPlayback:retryPlaybackQuality};
}());
