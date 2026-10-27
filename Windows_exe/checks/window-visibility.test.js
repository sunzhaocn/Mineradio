"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../desktop/main.js'),'utf8');
function harness(){
 let minimized=true,now=10000;
 const win={isDestroyed:()=>false,isMinimized:()=>minimized,isVisible:()=>true};
 const context={mainWindow:win,Date:{now:()=>now},startupCompleted:true,appQuitting:false,
   fullDesktopModeHostVisibilityTransitionDepth:0,fullDesktopModeRuntime:{getStatus:()=>({enabled:false}),isEnabled:()=>false},launchInTray:false};
 vm.createContext(context);
 for(const name of ['consumeMainWindowMinimizeIntent','clearMainWindowMinimizeIntent','shouldRestoreUnexpectedMainWindowMinimize','showMainWindowSafely']){
  const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);
  vm.runInContext(source.slice(start,end),context);
 }
 return {win,context,advance:()=>{now+=60000},restore:()=>{minimized=false;context.clearMainWindowMinimizeIntent(win)}};
}
test('OS minimization without WM_SYSCOMMAND stays minimized beyond watchdog and intent expiry',()=>{
 const h=harness();const result=h.context.consumeMainWindowMinimizeIntent(h.win);
 assert.equal(result.intentional,true);assert.equal(result.reason,'system-minimize');
 h.advance();assert.equal(h.context.shouldRestoreUnexpectedMainWindowMinimize(h.win),false);
 assert.equal(h.context.showMainWindowSafely(h.win,'did-finish-load'),false);
});
test('explicit minimization reason is retained and a user restore clears it',()=>{
 const h=harness();h.win.__mineradioMinimizeIntentUntil=12000;h.win.__mineradioMinimizeIntentReason='renderer-window-control';
 assert.equal(h.context.consumeMainWindowMinimizeIntent(h.win).reason,'renderer-window-control');
 h.restore();assert.equal(h.win.__mineradioIntentionalMinimize,false);
 assert.equal(h.context.shouldRestoreUnexpectedMainWindowMinimize(h.win),false);
});
