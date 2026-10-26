'use strict';
const {chromium}=require('../../Windows_exe/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
let browser;
(async()=>{
 browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
 const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:18080'));
 await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready);
 const report=await page.evaluate(async()=>{
  async function request(url,payload){
   const response=await fetch(url,{method:payload?'POST':'GET',headers:{...localMusicCredentials.headers(url),...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(100000)});
   return response.json();
  }
  const report={};
  const cats=await Promise.all(['qq','kugou'].map(provider=>request('/api/library/catalog?provider='+provider+'&force=1')));
  for(let i=0;i<2;i++){
   const provider=['qq','kugou'][i],data=cats[i];
   report[provider]={ok:!!data.providers?.[provider]?.ok,configured:!!data.providers?.[provider]?.configured,count:data.playlists?.length||0,message:data.providers?.[provider]?.message||data.message||''};
  }
  const qishui=await request('/api/qishui/search?keywords='+encodeURIComponent('晴天')+'&limit=2');
  report.qishui={ok:Array.isArray(qishui.songs)&&qishui.songs.length>0,count:qishui.songs?.length||0,message:qishui.message||''};
  const target=cats[0].playlists?.filter(p=>p.editable&&p.canAdd&&p.canRemove).sort((a,b)=>Number(a.isLiked)-Number(b.isLiked)||a.trackCount-b.trackCount)[0];
  if(!target){report.write={ok:false,reason:'no editable QQ playlist'};return report;}
  const candidates=await request('/api/qq/search?keywords='+encodeURIComponent('晴天')+'&limit=3');
  let selected;
  for(const song of candidates.songs||[]){
   const membership=await request('/api/library/membership',{song,sources:[song],force:true});
   if(!membership.providers?.qq?.ok)continue;
   if(!membership.playlists.some(p=>p.provider==='qq'&&String(p.id)===String(target.id))){selected=song;break;}
  }
  if(!selected){report.write={ok:false,reason:'no confirmed absent test song'};return report;}
  const add=await request('/api/library/mutate',{provider:'qq',id:String(target.id),operation:'add',song:selected,requestId:crypto.randomUUID()});
  // Read before removing so a rejected or uncertain write never deletes an
  // existing user favorite. The chosen song was proven absent above.
  const after=await request('/api/library/membership',{song:selected,sources:[selected],force:true});
  const present=after.providers?.qq?.ok&&after.playlists.some(p=>p.provider==='qq'&&String(p.id)===String(target.id));
  let remove=null,restored=false;
  if(present){
   remove=await request('/api/library/mutate',{provider:'qq',id:String(target.id),operation:'remove',song:selected,requestId:crypto.randomUUID()});
   const check=await request('/api/library/membership',{song:selected,sources:[selected],force:true});
   restored=!!check.providers?.qq?.ok&&!check.playlists.some(p=>p.provider==='qq'&&String(p.id)===String(target.id));
  }
  report.write={ok:!!(add.ok&&present&&remove?.ok&&restored),addConfirmed:!!add.ok,presentAfterAdd:!!present,
   removeConfirmed:!!remove?.ok,originalMembershipRestored:restored,addError:add.message||'',removeError:remove?.message||''};
  return report;
 });
 fs.writeFileSync(path.resolve('runtime/android-build/provider-roundtrip.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 assert(report.qq.ok&&report.kugou.ok&&report.qishui.ok&&report.write.ok);
 await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1;});
