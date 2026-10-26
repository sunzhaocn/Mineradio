package dev.mineradio.android;

import android.app.*;
import android.net.Uri;
import android.webkit.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;

/** A single isolated, cancellable Passport flow using the official bundled JS. */
public final class PassportBrowser {
    private static volatile Flow active;
    private static final AtomicInteger serial = new AtomicInteger();
    private static final ConcurrentHashMap<Integer, CompletableFuture<String>> pending = new ConcurrentHashMap<>();
    public static String open(String key, String token) throws Exception {
        CompletableFuture<String> future = new CompletableFuture<>();
        MineradioApp.app.main.post(() -> {
            if (active != null) active.destroy();
            active = new Flow(key, token, future);
        });
        return future.get(35, TimeUnit.SECONDS);
    }
    public static String call(String key, String method, String payload) throws Exception {
        Flow flow = active;
        if (flow == null || !flow.key.equals(key)) throw new IllegalStateException("Passport expired");
        int id = serial.incrementAndGet(); CompletableFuture<String> future = new CompletableFuture<>(); pending.put(id, future);
        MineradioApp.app.main.post(() -> {
            try {
                String expression;
                if ("request".equals(method)) {
                    flow.path = Uri.parse(new JSONObject(payload).getString("url")).getPath(); flow.signatureLength = 0; flow.tokenMatches = false;
                    expression = "window.__qishuiRequest(" + payload + ")";
                } else if ("verify_start".equals(method)) {
                    flow.show();
                    expression = "(()=>{window.__authMfaResult=null;let p=" + payload + ";window.__qishuiSecondVerify(p.decision,p.options).then(v=>window.__authMfaResult=v).catch(()=>window.__authMfaResult={status:false});return true})()";
                } else if ("verify_status".equals(method)) expression = "window.__authMfaResult||null";
                else throw new IllegalArgumentException();
                flow.view.evaluateJavascript("Promise.resolve(" + expression + ").then(r=>MineradioPassport.complete(" + id + ",JSON.stringify(r))).catch(()=>MineradioPassport.complete(" + id + ",'null'))", null);
            } catch (Exception error) { future.completeExceptionally(error); }
        });
        try {
            String value = future.get(30, TimeUnit.SECONDS);
            if ("request".equals(method)) {
                JSONObject result = new JSONObject(value); result.put("cookies", flow.cookies());
                result.put("_aBogusLength", flow.signatureLength); result.put("_msTokenMatches", flow.tokenMatches);
                return result.toString();
            }
            return value;
        } finally { pending.remove(id); }
    }
    public static void close(String key) { MineradioApp.app.main.post(() -> { if (active != null && active.key.equals(key)) { active.destroy(); active = null; } }); }
    private static final class Flow {
        final String key, token, base;
        final WebView view;
        final CompletableFuture<String> startup;
        volatile String path = "";
        volatile int signatureLength;
        volatile boolean tokenMatches;
        Dialog dialog;
        boolean destroyed;
        @android.annotation.SuppressLint("SetJavaScriptEnabled")
        Flow(String key, String token, CompletableFuture<String> future) {
            this.key=key;this.token=token;this.startup=future;
            base="https://api.qishui.com/_mineradio_passport_"+key+"/";
            view=new WebView(MineradioApp.app);
            view.getSettings().setJavaScriptEnabled(true); view.getSettings().setDomStorageEnabled(true);
            view.getSettings().setAllowFileAccess(false); view.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            view.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
            view.measure(android.view.View.MeasureSpec.makeMeasureSpec(900,1073741824),android.view.View.MeasureSpec.makeMeasureSpec(700,1073741824));view.layout(0,0,900,700);
            CookieManager manager=CookieManager.getInstance();manager.setAcceptCookie(true);manager.setAcceptThirdPartyCookies(view,true);
            for(String host:new String[]{"api.qishui.com","www.qishui.com","bff-pc.qishui.com"}) {
                String cookies=manager.getCookie("https://"+host);
                if(cookies!=null) for(String pair:cookies.split(";")) {
                    String name=pair.split("=",2)[0].trim();
                    manager.setCookie("https://"+host,name+"=; Max-Age=0; Path=/; Secure");
                    manager.setCookie("https://"+host,name+"=; Max-Age=0; Path=/; Domain=.qishui.com; Secure");
                }
            }
            view.addJavascriptInterface(new Object(){@JavascriptInterface public void complete(int id,String json){
                if(destroyed||active!=Flow.this)return;
                if(id==-1){try{startup.complete(new JSONObject(json).getString("encrypted"));}catch(Exception error){startup.completeExceptionally(error);}return;}
                CompletableFuture<String> f=pending.get(id);if(f!=null)f.complete(json);
            }},"MineradioPassport");
            view.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView web,WebResourceRequest request){
                    String url=request.getUrl().toString();String name=null;
                    if(url.startsWith(base)) name=request.getUrl().getLastPathSegment();
                    else if(url.equals("https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js")||url.equals("https://lf-c-flwb.bytetos.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js"))name="bdms.js";
                    if(name!=null&&Arrays.asList("security_seed.html","security_host.html","bdms.js","sdk-glue.js","react.js","react-dom.js").contains(name))try{
                        Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Access-Control-Allow-Origin","https://api.qishui.com");
                        return new WebResourceResponse(name.endsWith("html")?"text/html":"text/javascript","UTF-8",200,"OK",headers,MineradioApp.app.getAssets().open("passport/"+name));
                    }catch(IOException error){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
                    if("api.qishui.com".equals(request.getUrl().getHost())&&request.getUrl().getPath().equals(path)) {
                        String signature=request.getUrl().getQueryParameter("a_bogus");String ms=request.getUrl().getQueryParameter("msToken");
                        signatureLength=signature==null?0:signature.length();tokenMatches=token.equals(ms);
                    }
                    return null;
                }
                @Override public void onPageFinished(WebView web,String url){
                    if(url.equals(base+"security_seed.html")) web.evaluateJavascript("localStorage.setItem('xmst',"+JSONObject.quote(token)+");localStorage.setItem('xmsty',"+JSONObject.quote(token)+");true",v->web.loadUrl(base+"security_host.html"));
                    else if(url.equals(base+"security_host.html")) pollReady(System.currentTimeMillis()+25000);
                }
            });
            view.loadUrl(base+"security_seed.html");
        }
        void pollReady(long deadline){
            if(destroyed)return;
            view.evaluateJavascript("!!(window.bdms&&window._sdkGlueVersionMap&&window._sdkGlueVersionMap.bdmsVersion)",ready->{
                if("true".equals(ready))view.evaluateJavascript("window.__qishuiBrowserInfo().then(info=>MineradioPassport.complete(-1,JSON.stringify(info))).catch(()=>MineradioPassport.complete(-1,'{}'))",null);
                else if(System.currentTimeMillis()<deadline)MineradioApp.app.main.postDelayed(()->pollReady(deadline),200);
                else startup.completeExceptionally(new TimeoutException("Passport initialization timeout"));
            });
        }
        JSONArray cookies(){
            JSONArray values=new JSONArray();
            for(String host:new String[]{"api.qishui.com","www.qishui.com","bff-pc.qishui.com"}){
                String line=CookieManager.getInstance().getCookie("https://"+host);
                if(line!=null)for(String pair:line.split(";")){String[] parts=pair.trim().split("=",2);if(parts.length==2)try{JSONObject c=new JSONObject();c.put("name",parts[0]);c.put("value",parts[1]);c.put("domain",host);c.put("path","/");c.put("secure",true);c.put("httpOnly",true);values.put(c);}catch(JSONException ignored){}}
            }
            return values;
        }
        void show(){MainActivity activity=MainActivity.current.get();if(activity==null||activity.isFinishing())return;if(view.getParent() instanceof android.view.ViewGroup)((android.view.ViewGroup)view.getParent()).removeView(view);dialog=new AlertDialog.Builder(activity).setTitle("汽水音乐安全验证").setView(view).setNegativeButton("关闭窗口",(d,w)->{}).create();dialog.show();}
        void destroy(){destroyed=true;if(dialog!=null)dialog.dismiss();view.stopLoading();view.destroy();if(!startup.isDone())startup.completeExceptionally(new IllegalStateException("Passport closed"));}
    }
}
