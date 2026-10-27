'use strict';
const {app,BrowserWindow,ipcMain} = require('electron');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname,'../..');
const {createVideoExporter} = require(path.join(root,'Windows_exe/desktop/video-exporter'));
// The default Electron app interprets positional URLs as browser targets.
// Fixture paths and origin travel through the environment instead.
const folder = process.env.MR_VIDEO_FOLDER, origin = process.env.MR_VIDEO_ORIGIN;
app.setPath('userData',path.join(folder,'profile'));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  let statuses=[], cancelAtFrame=false, cancelDialog=false, dialogCalls=0, exporter;
  const destination=path.join(folder,'导出测试.mp4');
  const sender={isDestroyed:()=>false,send:(_channel,value)=>{
    statuses.push(value);
    if(cancelAtFrame && value.status==='rendering' && value.renderedFrames>=11){cancelAtFrame=false;exporter.cancel();}
  }};
  exporter=createVideoExporter({app,BrowserWindow,ipcMain,getOwner:()=>null,getBaseUrl:()=>origin,
    getFfmpeg:()=>path.join(root,'Windows_exe/build/tools/ffmpeg.exe'),isTrusted:event=>event.sender===sender,
    dialog:{showSaveDialog:async()=>{dialogCalls++;return {canceled:cancelDialog,filePath:destination};}}});
  const fixture=JSON.parse(fs.readFileSync(path.join(folder,'cases.json'),'utf8'));
  const results=[];
  function payload(item){return {
    audio:new Uint8Array(fs.readFileSync(path.join(folder,'tone.wav'))),
    song:{name:item.name,artist:'Synthetic'},lyric:'[00:00.00]First lyric\n[00:01.00]Second lyric',
    preset:{type:'mineradio-track-preset',schema:1,name:item.name,
      snapshot:{preset:item.preset,visualPresetSchema:fixture.visualPresetSchema,...item.snapshot},resources:item.resources||{}},
    width:item.width||1280,height:item.height||720,fps:item.fps||30,name:'导出测试.mp4',
    cover:fs.readFileSync(path.join(folder,'cover.txt'),'utf8'),
    video:item.movie?new Uint8Array(fs.readFileSync(path.join(folder,'movie.mp4'))):null
  };}
  for(const [index,item] of fixture.cases.entries()){
    statuses=[];
    const result=await exporter.start({sender},payload(item));
    assert.equal(result.ok,true);await exporter.wait();
    assert.equal(exporter.getState().status,'completed',JSON.stringify(exporter.getState()));
    const file='case-'+index+'.mp4';fs.renameSync(destination,path.join(folder,file));
    results.push({preset:item.preset,name:item.name,width:item.width||1280,height:item.height||720,fps:item.fps||30,
      file,state:exporter.getState(),statuses});
    console.log('EXPORTED',item.name);
  }
  const first=fixture.cases[0], keep=Buffer.from('existing destination must survive');
  fs.writeFileSync(destination,keep);
  statuses=[];cancelAtFrame=true;
  const before=new Set(fs.readdirSync(app.getPath('temp')).filter(name=>name.startsWith('mineradio-video-')));
  const starting=exporter.start({sender},payload(first));
  const concurrent=await exporter.start({sender},payload(first));assert.equal(concurrent.ok,false);
  assert.equal((await starting).ok,true);await exporter.wait();
  assert.equal(exporter.getState().status,'canceled');assert.deepEqual(fs.readFileSync(destination),keep);
  assert.ok(!fs.readdirSync(folder).some(name=>name.endsWith('.part.mp4')));
  assert.ok(fs.readdirSync(app.getPath('temp')).filter(name=>name.startsWith('mineradio-video-')).every(name=>before.has(name)));
  const invalid=payload(first);invalid.audio=new Uint8Array([1,2,3]);
  assert.equal((await exporter.start({sender},invalid)).ok,true);await exporter.wait();
  assert.equal(exporter.getState().status,'error');assert.deepEqual(fs.readFileSync(destination),keep);
  const calls=dialogCalls;assert.equal((await exporter.start({sender:{}},payload(first))).ok,false);assert.equal(dialogCalls,calls);
  cancelDialog=true;assert.equal((await exporter.start({sender},payload(first))).canceled,true);assert.deepEqual(fs.readFileSync(destination),keep);
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({passed:true,cases:results,
    cancellationPreservesExistingFile:true,concurrentExportRejected:true,temporaryFilesRemoved:true,
    corruptAudioRejected:true,untrustedSenderRejected:true,saveDialogCancellationPreservesFile:true},null,2));
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
