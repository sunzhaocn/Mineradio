const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../assets/ios-bridge.js'),'utf8');
function fixture(native) {
  class Document extends EventTarget {
    get hidden() { return false; }
    get visibilityState() { return 'visible'; }
    getElementById() { return null; }
    createElement(tag) {
      assert.equal(tag,'canvas');
      return {width:0,height:0,getContext(){return {drawImage(){}}},toDataURL(){return 'data:image/jpeg;base64,QQ==';}};
    }
  }
  class Anchor { click() {} }
  class Image {
    constructor(){this.width=1024;this.height=512;}
    set src(value){this._src=value;if(this.onload)this.onload();}
  }
  const actions=new Map(),posts=[],intervals=[],events=new EventTarget();
  const ctx={Document,document:new Document(),Event,EventTarget,HTMLAnchorElement:Anchor,Image,
    URL:{createObjectURL(){return 'blob:fixture'},revokeObjectURL(){}},
    navigator:{mediaSession:{setActionHandler(name,fn){actions.set(name,fn)},setPositionState(){}}},
    MediaMetadata:class {constructor(value){Object.assign(this,value)}},
    setTimeout(){return 1},clearTimeout(){},setInterval(fn){intervals.push(fn)},
    addEventListener:events.addEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),
    mineradioIOSNativeMedia:native,mineradioIOSForeground:true,
    pending:{options:{startPaused:true}},audioFadeSerial:0,playing:true,playCalls:0,
    playbackResolutionRuntime(){return {active:ctx.pending}},clearAudioFadeTimers(){},setPlayIcon(){},syncPlaybackStateFromAudioEvent(){},
    attemptAudioPlay(){ctx.playCalls++;return Promise.resolve()},
    playQueue:[{id:'1',title:'Synthetic track',artist:'Fixture',album:'Public synthetic',cover:'https://p1.music.126.net/public.jpg'}],currentIdx:0,
  };
  ctx.audio=new EventTarget();Object.assign(ctx.audio,{paused:true,ended:false,currentTime:10,duration:120,playbackRate:1,pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}});
  ctx.webkit={messageHandlers:{mineradio:{postMessage(message){posts.push(message);queueMicrotask(()=>ctx.mineradioIOSReply(message.id,true,null));}}}};
  ctx.window=ctx;
  vm.runInNewContext(source,ctx);
  return {ctx,actions,posts,intervals,events};
}
(async()=>{
  const {ctx,actions,posts,intervals,events}=fixture(true);
  assert.equal(actions.size,0,'native media owns controls without duplicate Web Media handlers');
  ctx.mineradioIOSAction('play');assert.equal(ctx.pending.options.startPaused,false);assert.equal(ctx.playCalls,0);
  ctx.mineradioIOSAction('pause');assert.equal(ctx.pending.options.startPaused,true);assert.equal(ctx.playing,false);
  ctx.pending=null;ctx.mineradioIOSAction('play');assert.equal(ctx.playCalls,1);
  intervals[0]();await new Promise(resolve=>setImmediate(resolve));
  const playback=posts.filter(item=>item.op==='playback').at(-1);
  assert.equal(playback.args.title,'Synthetic track');assert.equal(playback.args.artist,'Fixture');
  assert.match(playback.args.artwork,/^data:image\/jpeg;base64,/);
  let enters=0;events.addEventListener('mineradio:app-enter',()=>enters++);
  ctx.mineradioIOSSetForeground(false);assert.equal(ctx.document.hidden,true);
  ctx.mineradioIOSSetForeground(true);assert.equal(ctx.document.hidden,false);assert.equal(enters,1);
  ctx.mineradioIOSSetForeground(true);assert.equal(enters,1);
  const fallback=fixture(false);assert.equal(fallback.actions.size,5);
  let fallbackEnters=0;fallback.events.addEventListener('mineradio:app-enter',()=>fallbackEnters++);
  fallback.ctx.mineradioIOSSetForeground(false);fallback.ctx.mineradioIOSSetForeground(true);assert.equal(fallbackEnters,1);
  console.log('iOS native media selection, artwork, pending playback intent and foreground checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
