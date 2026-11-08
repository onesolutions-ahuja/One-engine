import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const dist = resolve('apps/web/dist');
for (const file of ['index.html', '404.html', 'component-sandbox.js']) {
  if (!existsSync(resolve(dist,file))) throw new Error('Missing release asset: '+file);
}
const html=readFileSync(resolve(dist,'index.html'),'utf8');
const fallback=readFileSync(resolve(dist,'404.html'),'utf8');
if (!html.includes('<html') || !fallback.includes('<html')) throw new Error('Invalid HTML entrypoint');
const refs=[...html.matchAll(/(?:src|href)=[\"']([^\"']+\.(?:js|css))[\"']/g)].map(x=>x[1]);
if (!refs.length) throw new Error('No JS or CSS bundle references');
for(const ref of refs) {
 const asset=resolve(dist,ref.replace(/^\//,''));
 if (!asset.startsWith(dist+'/') || !existsSync(asset)) throw new Error('Missing linked asset: '+ref);
}
if (!readdirSync(resolve(dist,'assets')).some(x=>x.endsWith('.js'))) throw new Error('No JavaScript generated');
if (process.argv.includes('--live')) {
  // GitHub Pages serves a small redirect at /login; it deliberately contains no application bundle.
  // The actual Vite entrypoint is the site's root /, so compare against that instead.
  const host=(process.env.METADRIVE_PAGES_URL||'https://unesolutions.co.uk').replace(/\/$/,'');
  const expected=refs.filter(ref=>ref.endsWith('.js')).map(ref=>ref.split('/').at(-1));
  if (!expected.length) throw new Error('Missing generated JavaScript entrypoint');
  let lastObserved='No response';
  let verified=false;
  // GitHub Pages/CDN propagation can lag behind actions/deploy-pages reporting success.
  for (let attempt=1;attempt<=24;attempt++) {
    try {
      const url=host+'/?metadrive_release_probe='+Date.now();
      const response=await fetch(url,{
        cache:'no-store',
        headers:{'Cache-Control':'no-cache'},
        signal:AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('HTTP '+response.status);
      const live=await response.text();
      const liveNames=[...live.matchAll(/(?:src|href)=["']([^"']+\.js)["']/g)]
        .map(match=>match[1].split('/').at(-1));
      lastObserved='expected='+expected.join(',')+' observed='+liveNames.join(',')+
        ' cache-control='+(response.headers.get('cache-control')||'none');
      if (!live.includes('<html')) throw new Error('Site root is not HTML');
      if (expected.every(name=>liveNames.includes(name))) {
        // Confirm that the published login route resolves to the SPA redirect.
        const login=await fetch(host+'/login?metadrive_release_probe='+Date.now(),{
          cache:'no-store',signal:AbortSignal.timeout(15000)
        });
        if (!login.ok) throw new Error('Login page unavailable: HTTP '+login.status);
        const loginHtml=await login.text();
        if (!loginHtml.includes('__spa') && !expected.some(name=>loginHtml.includes(name)))
          throw new Error('Login route did not provide the SPA redirect or application entrypoint');
        verified=true;
        break;
      }
    } catch(error) {
      lastObserved+=(lastObserved?' | ':'')+'request error: '+String(error);
    }
    console.log('Waiting for Pages CDN publication, attempt '+attempt+'/24: '+lastObserved);
    if (attempt<24) await new Promise(resolve=>setTimeout(resolve,5000));
  }
  if (!verified) throw new Error('Live application still differs from published build: '+lastObserved);

}
console.log('Pages build verified'+(process.argv.includes('--live')?' live':''));
