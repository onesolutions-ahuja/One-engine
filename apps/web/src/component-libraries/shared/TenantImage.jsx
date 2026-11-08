const idPattern=/^asset:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const types=new Set(["image/png","image/jpeg","image/webp","image/gif"]);
/** Tenant image bytes belong to this component instance, never a global cross-tenant cache.
 *  A new inline loadAsset callback on a parent render must NOT clear a stable picture. */
export function useTenantImageSource(src,loadAsset) {
  const [loaded,setLoaded]=React.useState({src:"",url:""});
  const loader=React.useRef(loadAsset);
  loader.current=loadAsset;
  React.useEffect(()=>{
    let active=true;
    const match=typeof src==="string"?src.match(idPattern):null;
    if(!match||typeof loader.current!=="function")return ()=>{active=false;};
    Promise.resolve().then(()=>loader.current(match[1])).then(asset=>{
      if(!active||!asset||!types.has(asset.contentType)
        ||typeof asset.contentBase64!=="string"
        ||asset.contentBase64.length>7100000
        ||!/^[A-Za-z0-9+/]+={0,2}$/.test(asset.contentBase64))return;
      setLoaded({src,url:"data:"+asset.contentType+";base64,"+asset.contentBase64});
    }).catch(()=>{if(active)setLoaded({src,url:""});});
    return ()=>{active=false;};
  },[src]);
  // https URLs and inline raster images (e.g. the tenant logo from $tenant.logo) need no media request.
  const external=typeof src==="string"&&(/^https:\/\//i.test(src)
   ||/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(src));
  // Never flash a previous asset while a different image is being requested.
  const source=external?src:loaded.src===src?loaded.url:"";
  return source;
}
export default function OneTenantImage({src,alt="",loadAsset,...props}){
  const source=useTenantImageSource(src,loadAsset);
  return source?<img {...props} src={source} alt={alt}/>:
    <span className="one-empty" role="status">Image unavailable</span>;
}
