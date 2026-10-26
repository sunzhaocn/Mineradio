'use strict';
// Exercise the shipped UI and backend with synthetic sessions only.
const {_electron}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'verification');
const profile=path.join(out,`kugou-cookie-profile-${process.pid}`);
fs.mkdirSync(profile,{recursive:true});
fs.writeFileSync(path.join(profile,'backend-ports.json'),JSON.stringify({web:19580,api:19500}));
const report={ok:false,syntheticCredentialsOnly:true,realAccountStorageTouched:false,checks:[],errors:[]};
let app;
(async()=>{
 try{
  const env={...process.env,MINERADIO_STARTUP_QA_HIDDEN:'1',MINERADIO_STARTUP_QA_USER_DATA:profile,MINERADIO_NO_DESKTOP_SHORTCUT:'1',MINERADIO_CLIENT_ASSET_INIT:'0'};
  delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:path.resolve(process.argv[2]||path.join(root,'dist/win-unpacked/Mineradio.exe')),env,timeout:90000});
  const page=await app.firstWindow({timeout:60000});
  let authRequests=0;
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/local/profile')return route.continue();
   if(url.pathname.startsWith('/api/local/auth/'))authRequests++;
   // Catalogue and QR routes are controlled so no test changes a real session.
   await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,songs:[],tracks:[],items:[],playlists:[],providers:{},key:'synthetic-cookie-test-key-0123456789',status:'waiting',expires_in:180})});
  });
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.waitForURL(/http:\/\/127\.0\.0\.1:19580\//,{timeout:60000});
  await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready,null,{timeout:60000});
  if(await page.locator('#splash').isVisible()){
   await page.waitForFunction(()=>typeof splashReadyToEnter!=='undefined'&&splashReadyToEnter);
   await page.locator('#splash').click();await page.locator('#splash').waitFor({state:'hidden'});
  }
  const cookie='userid=42; token=synthetic-client; t=synthetic-web; kg_mid=existing-mid; kg_dfid=existing-dfid; KuGoo=KugooID%3D42%26t%3Dsynthetic-web%26NickName%3DSynthetic%26Pic%3Dhttps%253A%252F%252Fimge.kugou.com%252Favatar.jpg';
  for(let i=0;i<3;i++){
   await page.evaluate(()=>showLoginModal({provider:'kugou'}));
   await page.locator('#login-modal').waitFor({state:'visible'});
   const relogin=page.getByRole('button',{name:'重新登录',exact:true});
   if(await relogin.isVisible())await relogin.click();
   await page.getByRole('button',{name:'手动输入 Cookie',exact:true}).click();
   await page.getByLabel('登录 Cookie',{exact:true}).fill(cookie);
   const before=authRequests;
   await page.getByRole('button',{name:'保存并应用 Cookie',exact:true}).click();
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mineradio-local-accounts-v1')||'{}').kugou?.account?.name==='Synthetic');
   const state=await page.evaluate(()=>{const a=JSON.parse(localStorage.getItem('mineradio-local-accounts-v1')).kugou;return{cookie:a.cookie,name:a.account.name,avatar:a.account.avatar,loggedIn:localMusicCredentials.status('kugou').loggedIn}});
   assert.equal(state.cookie,cookie);assert(state.loggedIn&&state.avatar);
   assert.equal(authRequests,before,'Applying Cookie must not initiate or poll a login');
   report.checks.push({attempt:i+1,cookieUnchanged:state.cookie===cookie,profilePreserved:!!state.avatar,additionalLoginRequests:authRequests-before});
   await page.evaluate(()=>closeLoginModal());
   await page.locator('#login-modal').waitFor({state:'hidden'});
  }
  // The real packaged backend must decode a Cookie without emitting Set-Cookie.
  const backend=await page.evaluate(async cookie=>{
   const response=await fetch('/api/local/profile?provider=kugou',{headers:{'X-Music-Credentials':JSON.stringify({kugou:{cookie}})}});
   const result=await response.json();return{status:response.status,name:result.account?.name,hasReturnedCookie:'cookie'in result||'credentials'in result};
  },cookie);
  assert.equal(backend.status,200);assert.equal(backend.name,'Synthetic');assert(!backend.hasReturnedCookie);
  report.backend=backend;
  assert.equal(report.errors.length,0);report.ok=true;
 }catch(e){report.failure=e.stack||String(e);process.exitCode=1;}
 finally{if(app)await app.close().catch(()=>{});fs.writeFileSync(path.join(out,'kugou-cookie.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
