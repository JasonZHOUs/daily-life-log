/* Offline support: serve the app shell from cache instantly, refresh it in the
   background, and tell the page when index.html or a script has changed. */
const C='dl-shell-v1';
const SUPA='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const SHELL=['./','config.js','manifest.webmanifest','icon-180.png','icon-512.png',SUPA];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
// The page that triggered the check may still be loading, so tell everyone now and again a little later.
const send=()=>self.clients.matchAll({includeUncontrolled:true}).then(cs=>cs.forEach(c=>c.postMessage({type:'update'})));
const notify=()=>send().then(()=>new Promise(r=>setTimeout(r,2500))).then(send);

// Reminders from api/push-tick.js: { title, body, tag, url }
self.addEventListener('push',e=>{
  let p={};try{p=e.data?e.data.json():{}}catch(x){p={body:e.data&&e.data.text()}}
  e.waitUntil(self.registration.showNotification(p.title||'Daily Life Log',{body:p.body||'',tag:p.tag||undefined,icon:'icon-180.png',badge:'icon-180.png',data:{url:p.url||'/'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||'/';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){if('focus' in c){c.navigate&&c.navigate(url);return c.focus()}}
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url),nav=r.mode==='navigate';
  if(r.method!=='GET'||u.pathname.startsWith('/api/'))return;
  // Supabase API, Open Food Facts and anything else always go to the network.
  if(!(nav||u.origin===location.origin||u.href===SUPA))return;
  const key=nav?'./':r,watch=nav||(u.origin===location.origin&&u.pathname.endsWith('.js'));
  e.respondWith(caches.open(C).then(async c=>{
    const hit=await c.match(key,{ignoreSearch:true}),old=hit&&watch?hit.clone():null;
    const net=fetch(r).then(async res=>{
      if(res.ok){
        const fresh=res.clone();
        if(old){
          const [a,b]=await Promise.all([old.text(),fresh.clone().text()]);
          await c.put(key,fresh);
          if(a!==b)await notify();
        }else await c.put(key,fresh);
      }
      return res;
    });
    if(hit){e.waitUntil(net.catch(()=>{}));return hit}
    return net;
  }));
});
