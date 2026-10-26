const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../assets/ios-bridge.js'),'utf8');
const origin='http://127.0.0.1:18080';
const audio=Buffer.concat([Buffer.from('fLaC'),Buffer.alloc(96)]);
function response(body=audio,headers={},status=200,extra={}) {
  const blob=new Blob([body],{type:headers['content-type']||'audio/flac'});
  return Object.assign({ok:status>=200&&status<300,status,url:'',redirected:false,
    headers:new Headers(Object.assign({'content-type':'audio/flac','content-length':String(blob.size)},headers)),
    blob:async()=>blob,json:async()=>JSON.parse(Buffer.from(await blob.arrayBuffer()).toString())},extra);
}
function fixture(handler=async()=>response()) {
  const listeners=new Map(),posts=[],fetches=[],credentialCalls=[],toasts=[];
  class Document {
    get hidden(){return false;}
    get visibilityState(){return 'visible';}
    getElementById(){return null;}
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);}
    dispatchEvent(){return true;}
  }
  class Anchor {
    constructor(href='',name){this._href=href;this.attributes=new Map();this.originalClicks=0;if(name!==undefined)this.download=name;}
    get href(){return new URL(this._href,origin+'/').href;}
    set href(value){this._href=value;}
    get download(){return this.attributes.get('download')||'';}
    set download(value){this.attributes.set('download',String(value));}
    hasAttribute(name){return this.attributes.has(name);}
    click(){this.originalClicks++;}
  }
  class LocalURL extends URL {}
  let blobSerial=0;
  LocalURL.createObjectURL=()=>`blob:fixture-${++blobSerial}`;LocalURL.revokeObjectURL=()=>{};
  const ctx={Document,document:new Document(),Event,HTMLAnchorElement:Anchor,URL:LocalURL,
    location:{origin,href:origin+'/'},navigator:{},Blob,Uint8Array,AbortController,TypeError,
    btoa(value){return Buffer.from(value,'binary').toString('base64');},
    setTimeout,clearTimeout,setInterval(){},addEventListener(){},dispatchEvent(){},
    showToast(value){toasts.push(value);},
    localMusicCredentials:{headers(url){credentialCalls.push(url);return {'X-Music-Credentials':'synthetic-current-account'};}},
    fetch:async(url,options)=>{fetches.push({url,options});return handler(url,options);},
  };
  ctx.webkit={messageHandlers:{mineradio:{postMessage(message){posts.push(message);
    queueMicrotask(()=>ctx.mineradioIOSReply(message.id,message.op==='beginSave'?'export-token':true,null));}}}};
  ctx.window=ctx;vm.runInNewContext(source,ctx);
  function userClick(anchor){
    const event={target:{closest(selector){return selector==='a'?anchor:null;}},prevented:false,stopped:false,
      preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
    for(const listener of listeners.get('click')||[]){listener(event);if(event.stopped)break;}
    return event;
  }
  return {ctx,Anchor,posts,fetches,credentialCalls,toasts,userClick};
}
const url='/api/download?provider=qishui&id=123&quality=highest';
const settle=async()=>{for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));};
const begin=fixture=>fixture.posts.filter(post=>post.op==='beginSave');
(async()=>{
  {
    const f=fixture(async()=>response(audio,{'content-disposition':"attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.flac"}));
    const anchor=new f.Anchor(url+'&credentials=stale&cookie=old&session_config=previous','fallback.mp3');anchor.click();await settle();
    assert.equal(anchor.originalClicks,0);assert.equal(f.fetches.length,1);assert.equal(begin(f).length,1);
    assert.equal(begin(f)[0].args.name,'测试.flac');assert.equal(begin(f)[0].args.size,audio.length);
    const request=f.fetches[0];assert.equal(request.options.headers['X-Music-Credentials'],'synthetic-current-account');
    assert.equal(request.options.redirect,'error');assert.equal(request.options.credentials,'omit');
    assert.ok(!/credentials=|cookie=|session_config=/.test(request.url));assert.equal(f.credentialCalls.length,1);
    assert.equal(f.posts.filter(post=>post.op==='finishSave').length,1);
    assert.deepEqual(Buffer.concat(f.posts.filter(post=>post.op==='appendSave').map(post=>Buffer.from(post.args.data,'base64'))),audio);
  }
  {
    let release;const pending=new Promise(resolve=>release=resolve),f=fixture(()=>pending);
    const anchor=new f.Anchor(url,'song.flac');anchor.click();
    const event=f.userClick(anchor);await settle();assert.equal(event.prevented,true);assert.equal(event.stopped,true);
    assert.equal(f.fetches.length,1,'programmatic and user clicks share one active request');
    release(response());await settle();assert.equal(begin(f).length,1);
  }
  {
    const f=fixture(),anchor=new f.Anchor(url);const event=f.userClick(anchor);await settle();
    assert.equal(event.prevented,true,'known attachment route works without a download attribute');assert.equal(begin(f).length,1);
  }
  {
    const f=fixture(),blob=new Blob(['preset fixture'],{type:'application/json'});
    const anchor=new f.Anchor(f.ctx.URL.createObjectURL(blob),'');anchor.click();f.userClick(anchor);await settle();
    assert.equal(f.fetches.length,0);assert.equal(begin(f).length,1,'empty download attribute still exports tracked Blob');
  }
  {
    const f=fixture();for(const target of ['https://evil.example/api/download?provider=qishui&id=123',
      origin+'/api/download/qualities?provider=qishui&id=123',origin+'/api/download-other?provider=qishui&id=123']){
      const anchor=new f.Anchor(target,'song.flac');anchor.click();assert.equal(anchor.originalClicks,1);
    }
    await assert.rejects(f.ctx.mineradioIOSDownload('https://evil.example/api/download?provider=qishui&id=123'));
    assert.equal(f.fetches.length,0);assert.equal(f.credentialCalls.length,0);
  }
  {
    const f=fixture();new f.Anchor(url+'&url=https%3A%2F%2Fevil.example%2Faudio.flac','song.flac').click();await settle();
    assert.equal(f.fetches.length,0);assert.equal(begin(f).length,0);assert.equal(f.toasts.length,1);
  }
  for(const [label,make] of [
    ['JSON error',()=>response('{"message":"Synthetic unavailable"}',{'content-type':'application/json'})],
    ['mislabeled JSON',()=>response('{"error":"synthetic"}',{'content-type':'audio/flac'})],
    ['HTML error',()=>response('<html>Error</html>',{'content-type':'text/html'})],
    ['HTTP failure',()=>response('Denied',{'content-type':'text/plain'},403)],
    ['empty body',()=>response(Buffer.alloc(0))],
    ['truncated body',()=>response(audio,{'content-length':String(audio.length+10)})],
    ['partial body',()=>response(audio,{'content-range':'bytes 0-99/200'},206)],
    ['oversized body',()=>response(audio,{'content-length':String(512*1024*1024+1)})],
    ['redirect',()=>response(audio,{},200,{redirected:true,url:'https://evil.example/audio.flac'})],
  ]){
    const f=fixture(async()=>make());await assert.rejects(f.ctx.mineradioIOSDownload(url,'song.flac'),undefined,label);
    assert.equal(begin(f).length,0,label+' must not be exported');
  }
  {
    const f=fixture(async()=>{throw new TypeError('synthetic network error');});
    await assert.rejects(f.ctx.mineradioIOSDownload(url),/下载连接失败/);assert.equal(begin(f).length,0);
  }
  console.log('iOS Blob and authenticated local HTTP downloads, deduplication, response validation and origin boundary checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
