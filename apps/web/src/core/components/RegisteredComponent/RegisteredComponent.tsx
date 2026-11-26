import {disabledWhen} from '../../../component-libraries/shared/showWhen.js';
import {usePageFormulaScope,useFormulaDependencyVersion,PublishedFormulaProperties} from './PageFormulaScope';
import {useSharedRendererStyle} from './sharedRendererStyle';
import * as React from 'react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LibraryComponentMetadata } from '../../metadata/Definitions/metadata';
import ComponentSandbox from '../ComponentSandbox/ComponentSandbox';
import {availableComponentSettings,type PropertyDevice,resolveComponentSettings,validateComponentDefinitions,validateComponentSettings} from '../Properties/componentSettingDefinitions';
import {compileComponentModule} from './componentRuntimeModule';
import {loadBundledRenderer,peekBundledRenderer} from './bundledAssetCache';
import {applyRecordViewAdapter} from '../../records/RecordWorkspace/recordViewAdapterRegistry';
import {registeredComponentAppearance, registeredComponentAppearanceClasses} from './registeredComponentAppearance';
import './registeredComponentAppearance.css';
import {pagePropertyIssues} from '../Properties/pagePropertyContract';
import {resolveRegisteredTextProperties,FieldExpressionEvaluationError} from './fieldExpressionRuntime';
import {formulaCompilers} from '../../pages/PageCompiler/formulaText';
import {resolveComponentFormulaProps} from './componentFormulaProps';
import {validatePrimitiveMetadata, primitiveAccessibilityProps} from './sharedPrimitiveMetadata';
import {loadSharedSmartRenderer} from './sharedSmartRenderer';

/** Set once the shared Smart runtime fails to load in this tab: use full renderers. */
let sharedSmartFailed=false;

type BundledAsset={apiName:string;version:number;compiledJs:string;scopedCss:string;defaultProps?:Record<string,unknown>;sharedSmartRuntime?:boolean;sharedRuntimePath?:string};
function sharedSmartOptIn():boolean{
 if(typeof window==='undefined')return true;
 try{return window.sessionStorage.getItem('metadrive:shared-smart-runtime')!=='0';}
 catch{return true;}
}
/** Which renderer file a bundled component uses, its cache key and how to load it.
 * One place for components and for preloading, so both share one cache entry. */
function rendererRequest(definition:LibraryComponentMetadata){
 const assetApiName=definition.apiName;
 const sharedPath=(definition as LibraryComponentMetadata & {sharedAssetPath?:unknown}).sharedAssetPath;
 const selectedPath=sharedSmartOptIn()&&!sharedSmartFailed&&typeof sharedPath==='string'&&assetApiName.startsWith('smart_')
  ?sharedPath:(definition as LibraryComponentMetadata & {assetPath?:unknown}).assetPath;
 // Content hashes are immutable; legacy URLs are shared only in-flight.
 const match=typeof selectedPath==='string'
  ?/^component-library\/components\/([A-Za-z][A-Za-z0-9_]*)\.([0-9a-f]{16})\.json$/.exec(selectedPath):null;
 const trustedHashed=match?.[1]===assetApiName;
 const assetPath=trustedHashed?selectedPath as string:
  'component-library/components/'+encodeURIComponent(assetApiName)+'.json';
 // The key includes the component version, so the result is safe to keep for the session.
 const key=assetPath+'@'+definition.version;
 const load=()=>loadBundledRenderer(key,()=>fetch(`${import.meta.env.BASE_URL}${assetPath}`,
  {cache:trustedHashed?'force-cache':'no-cache'})
  .then(async response=>{
   if(!response.ok)throw Error('Bundled renderer is unavailable');
   return response.json();
  }).then(async(value:unknown)=>{
   if(!value||typeof value!=='object')throw Error('Invalid bundled renderer');
   const entry=value as Record<string,unknown>;
   if(entry.apiName!==assetApiName||entry.version!==definition.version||
     typeof entry.compiledJs!=='string'||typeof entry.scopedCss!=='string')
     throw Error('Bundled renderer revision mismatch');
   if(entry.sharedSmartRuntime===true){
    if(!assetApiName.startsWith('smart_')||entry.compiledJs!=='')
     throw Error('Invalid shared Smart renderer');
    entry.compiledJs=await loadSharedSmartRenderer(entry.sharedRuntimePath,import.meta.env.BASE_URL);
   }else if(!entry.compiledJs)throw Error('Bundled renderer revision mismatch');
   if(entry.defaultProps!==undefined&&(!entry.defaultProps||
     typeof entry.defaultProps!=='object'||Array.isArray(entry.defaultProps)))
     throw Error('Invalid application component defaults');
   return entry as BundledAsset;
  }),true);
 return {key,load,usesShared:selectedPath===sharedPath};
}
const needsRendererFile=(definition:LibraryComponentMetadata)=>definition.trustedBundled===true&&!definition.compiledJs;
/** Download (once) the renderers a screen will need before it opens, e.g. a popup's
 * components while the page that opens it is idle: the popup then draws at once. */
export function preloadComponentRenderers(definitions:readonly LibraryComponentMetadata[]):void{
 for(const definition of definitions)
  if(needsRendererFile(definition))void rendererRequest(definition).load().catch(()=>undefined);
}

type ComponentBoundaryState = { error?: string };

class ComponentRenderBoundary extends React.Component<{ children: ReactNode }, ComponentBoundaryState> {
  state: ComponentBoundaryState = {};

  static getDerivedStateFromError(error: Error): ComponentBoundaryState {
    return { error: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Registered component render failed', error, info.componentStack);
  }

  render() {
    if (this.state.error) return <div className="registered-component-error" role="alert">Component error: {this.state.error}</div>;
    return this.props.children;
  }
}

// Only server-trusted bundled components reach this cache; untrusted tenant JSX
// continues through its isolated sandbox, never the host compiler.
const trustedModules=new Map<string,ReturnType<typeof compileComponentModule>>();
function resolveTrustedModule(source:string){
 const cached=trustedModules.get(source);
 if(cached)return cached;
 const compiled=compileComponentModule(source,React);
 if(trustedModules.size>=32)trustedModules.delete(trustedModules.keys().next().value!);
 trustedModules.set(source,compiled);
 return compiled;
}
function RegisteredComponentBody({ definition, props, appearanceProps, layoutTransparent=false }: { definition: LibraryComponentMetadata; props: Record<string, unknown>; appearanceProps: Record<string, unknown>; layoutTransparent?:boolean }) {
  const Component = useMemo(() => resolveTrustedModule(definition.compiledJs), [definition.compiledJs]);
  useSharedRendererStyle(definition.scopedCss);

  const disabled=!props.builderPreview&&!props.designMode&&(props.disabled===true||disabledWhen(props,props.record??{}));
  const appearanceStyle = registeredComponentAppearance(appearanceProps);
  const appearanceClass = registeredComponentAppearanceClasses(appearanceProps);
  return <div className={`registered-component metadrive-component-${definition.apiName.toLowerCase()} ${appearanceClass}`}
    ref={element=>{if(element)element.inert=disabled;}} aria-disabled={disabled||undefined}
    style={layoutTransparent?{...appearanceStyle,display:'contents'}:appearanceStyle}>
    {typeof document==='undefined'&&definition.scopedCss&&<style>{definition.scopedCss}</style>}
    <Component {...props} {...((definition as LibraryComponentMetadata & {sharedSmartRuntime?:boolean}).sharedSmartRuntime===true
      ?{kind:definition.apiName}:{})} />
  </div>;
}

const emptyDefinitions:NonNullable<LibraryComponentMetadata['propertyDefinitions']>=[];
const schemaIssueCache=new WeakMap<object,ReturnType<typeof validateComponentDefinitions>>();
function cachedSchemaIssues(definitions:NonNullable<LibraryComponentMetadata['propertyDefinitions']>){
  let issues=schemaIssueCache.get(definitions);
  if(!issues){issues=validateComponentDefinitions(definitions);schemaIssueCache.set(definitions,issues);}
  return issues;
}
const availableSettingsCache=new WeakMap<object,Map<string,ReturnType<typeof availableComponentSettings>>>();
function cachedAvailableSettings(definitions:NonNullable<LibraryComponentMetadata['propertyDefinitions']>,
  device:PropertyDevice|undefined,version:number|undefined){
  let byKey=availableSettingsCache.get(definitions);
  if(!byKey){byKey=new Map();availableSettingsCache.set(definitions,byKey);}
  const key=String(device)+'|'+String(version);
  let result=byKey.get(key);
  if(!result){result=availableComponentSettings(definitions,device,version);byKey.set(key,result);}
  return result;
}
type ConfiguredSettings={configuredProps:ReturnType<typeof resolveComponentSettings>;
  issues:Array<ReturnType<typeof validateComponentSettings>[number]|ReturnType<typeof pagePropertyIssues>[number]>};
const configuredCache=new WeakMap<object,{definitions:object;appDefaults:object;preview:boolean;apiName:string;result:ConfiguredSettings}>();
function cachedConfiguredSettings(props:Record<string,unknown>,definitions:ReturnType<typeof availableComponentSettings>,
  appDefaults:Record<string,unknown>,preview:boolean,apiName:string):ConfiguredSettings{
  const cached=configuredCache.get(props);
  if(cached&&cached.definitions===definitions&&cached.appDefaults===appDefaults&&cached.preview===preview&&cached.apiName===apiName)
    return cached.result;
  const configuredProps=resolveComponentSettings(definitions,{...appDefaults,...props,builderPreview:preview});
  const issues=[...validateComponentSettings(definitions.filter(d=>d.schemaVersion===1),configuredProps),
    ...pagePropertyIssues('Custom:'+apiName,configuredProps)];
  const result={configuredProps,issues};
  configuredCache.set(props,{definitions,appDefaults,preview,apiName,result});
  return result;
}
const primitiveCheckCache=new WeakMap<object,ReturnType<typeof validatePrimitiveMetadata>>();
function cachedPrimitiveCheck(primitive:Parameters<typeof validatePrimitiveMetadata>[0]){
  let result=primitiveCheckCache.get(primitive as object);
  if(!result){result=validatePrimitiveMetadata(primitive);primitiveCheckCache.set(primitive as object,result);}
  return result;
}
const noAppDefaults:Record<string,unknown>={};

type RegisteredComponentProps={ definition: LibraryComponentMetadata; props: Record<string, unknown>; layoutTransparent?:boolean; editorPreview?:boolean;formulaInstanceId?:string };
// Page Builder canvas only: a click that selects one component must not re-render
// every other component on the canvas. Builder previews rebuild their props object
// (and its loadAsset helper) on every builder render, so compare values shallowly
// and treat function props as unchanged. Published runtime pages are never memoised.
function sameBuilderPreview(previous:RegisteredComponentProps,next:RegisteredComponentProps){
  if(!previous.editorPreview||!next.editorPreview)return false;
  if(previous.definition!==next.definition||previous.formulaInstanceId!==next.formulaInstanceId
    ||previous.layoutTransparent!==next.layoutTransparent)return false;
  const before=previous.props,after=next.props;
  const keys=Object.keys(after);
  if(keys.length!==Object.keys(before).length)return false;
  return keys.every(key=>{
    const a=before[key],b=after[key];
    return a===b||(typeof a==='function'&&typeof b==='function');
  });
}
export default React.memo(RegisteredComponent,sameBuilderPreview);
function RegisteredComponent({ definition, props, formulaInstanceId, layoutTransparent=false, editorPreview=false }: RegisteredComponentProps) {
  const [rendered,setRendered]=useState<Readonly<Record<string,string>>>({});
  const formulaScope=usePageFormulaScope();
  useFormulaDependencyVersion(formulaScope,props);
  // A renderer already downloaded (this page, an earlier screen or a preload) draws on the
  // first paint: no "loading" frame between opening a screen and seeing it.
  const [asset, setAsset] = useState<BundledAsset|null>(()=>needsRendererFile(definition)
    ?peekBundledRenderer<BundledAsset>(rendererRequest(definition).key)??null:null);
  const [assetError, setAssetError] = useState('');
  // Optional off-screen lazy hydration. Printing, editor previews and ordinary
  // pages keep their pre-existing eager behavior unless explicitly opted in.
  let lazyOptIn=false;
  if(typeof window!=='undefined'){
   try{lazyOptIn=window.sessionStorage.getItem('metadrive:lazy-smart-renderers')==='1';}
   catch{/* Protected browser storage: preserve eager loading. */}
  }
  const deferRenderer=lazyOptIn&&definition.trustedBundled===true
    &&!editorPreview&&props.printRows!==true&&props.builderPreview!==true
    &&props.previewOnly!==true;
  const [enteredViewport,setEnteredViewport]=useState(false);
  const placeholderRef=React.useRef<HTMLDivElement>(null);
  useEffect(()=>{
   if(!deferRenderer||enteredViewport)return;
   if(typeof IntersectionObserver==='undefined'){setEnteredViewport(true);return;}
   const target=placeholderRef.current;
   if(!target){setEnteredViewport(true);return;}
   const observer=new IntersectionObserver(entries=>{
    if(entries.some(entry=>entry.isIntersecting)){
     setEnteredViewport(true);
     observer.disconnect();
    }
   },{rootMargin:'250px'});
   observer.observe(target);
   return()=>observer.disconnect();
  },[deferRenderer,enteredViewport]);
  const assetApiName=definition.apiName;
  const [sharedRetry,setSharedRetry]=useState(0);
  const request=rendererRequest(definition);
  useEffect(() => {
    if (!definition.trustedBundled || definition.compiledJs || deferRenderer&&!enteredViewport) {
      setAsset(null); setAssetError(''); return;
    }
    let active=true;
    setAssetError('');
    const ready=peekBundledRenderer<BundledAsset>(request.key);
    if(ready){setAsset(current=>current===ready?current:ready);return;}
    setAsset(null);
    // The cache owns the request: unmounting one component never cancels a shared fetch.
    void request.load().then(value=>{if(active)setAsset(value);})
      .catch((error:unknown)=>{
        if(!active)return;
        // The shared runtime failed: use the component's own full renderer instead.
        if(request.usesShared&&!sharedSmartFailed){sharedSmartFailed=true;setSharedRetry(n=>n+1);return;}
        setAssetError(error instanceof Error?error.message:'Renderer load failed');
      });
    return()=>{active=false;};
  }, [definition.apiName,assetApiName,definition.version,definition.trustedBundled,
    definition.compiledJs,request.key,deferRenderer,enteredViewport,sharedRetry]); // eslint-disable-line react-hooks/exhaustive-deps
  if (definition.status === 'Draft') return <div role="status" className="registered-component-error">Component is a draft. Publish it before use.</div>;
  if(deferRenderer&&!enteredViewport)return <div ref={placeholderRef}
    className="registered-component-lazy-placeholder"
    style={{width:'100%',height:'100%',minHeight:32}} aria-hidden="true"/>;
  if (definition.trustedBundled && !definition.compiledJs && assetError)
    return <div role="alert" className="registered-component-error">{assetError}</div>;
  if (definition.trustedBundled && !definition.compiledJs && (!asset || asset.apiName!==assetApiName || asset.version!==definition.version))
    // Nothing to read while the renderer arrives (no "Loading component…" flash): an empty box.
    return <div aria-busy="true" style={{width:'100%',height:'100%'}}/>;
  // Pure checks below are cached by their (stable) inputs: a formula value
  // change redraws this component, and re-validating the whole schema and
  // settings each time cost ~5 ms per component on a 50-box till page.
  const schemaIssues=cachedSchemaIssues(definition.propertyDefinitions??emptyDefinitions);
  if(schemaIssues.length)return <div role="alert" className="registered-component-error">Invalid component schema: {schemaIssues.map(i=>i.path+' '+i.message).join('; ')}</div>;
  const device = props.device==='Phone'?'Mobile':props.device as PropertyDevice|undefined;
  const definitions=cachedAvailableSettings(definition.propertyDefinitions??emptyDefinitions,device,definition.version);
  // Preserve existing page-authored values over source-controlled app defaults.
  // Smart component rendering uses manifest metadata, not legacy UI aliases.
  const appDefaults=definition.trustedBundled&&definition.apiName.startsWith('smart_')?(asset?.defaultProps??noAppDefaults):noAppDefaults;
  // This flag comes from the builder host, never from saved component metadata.
  const {configuredProps,issues}=cachedConfiguredSettings(props,definitions,appDefaults,editorPreview===true,
    definition.apiName);
  if(issues.length)return <div role="alert" className="registered-component-error">Invalid component settings: {issues.map(i=>i.path+' '+i.message).join('; ')}</div>;
  const formulaCode=(props.__formulaCode as {functions?:unknown}|undefined)?.functions;
  const codeFunctions=formulaCode instanceof Map
    ?formulaCode as Map<string,(row:Record<string,unknown>)=>unknown>:null;
  const sqlProps=resolveComponentFormulaProps(configuredProps,definition.apiName,codeFunctions,editorPreview===true);
  // One formula engine: the page file's functions, and for a formula given at run time the
  // same converter (the page's own `$` when the page has page code, else a standalone `$`).
  const given=props.__formulaCode as {functions?:unknown;compile?:unknown;compileNode?:unknown}|undefined;
  const standalone=typeof given?.compile==='function'?null:formulaCompilers(()=>({
    pageState:(props.pageState&&typeof props.pageState==='object'?props.pageState:undefined) as Record<string,unknown>|undefined,
    sessionId:typeof props.sessionId==='string'?props.sessionId:undefined,readComponent:formulaScope?.read,
    rowObject:typeof props.objectApiName==='string'?props.objectApiName:''}));
  const formulaCodeProp=!standalone&&codeFunctions?given!:{...(given??{}),functions:codeFunctions??new Map(),
    compile:standalone?standalone.compile:given!.compile,compileNode:standalone?standalone.compileNode:given!.compileNode};
  let effectiveProps:Record<string,unknown>;
  try{
    effectiveProps=resolveRegisteredTextProperties(definitions,applyRecordViewAdapter(sqlProps),undefined,formulaScope?.read,
      formulaCodeProp.compile as (text:unknown)=>((row:Record<string,unknown>)=>unknown)|null);
  }catch(error){
    if(error instanceof FieldExpressionEvaluationError)
      return <div className="registered-component-error" role="alert">Formula error: {error.message}</div>;
    throw error;
  }
  const published=<PublishedFormulaProperties id={formulaInstanceId} rendered={rendered} values={{...effectiveProps,__formulaCode:formulaCodeProp,kind:definition.apiName}}/>;
  const primitive = definition.primitiveMetadata;
  const primitiveCheck = primitive ? cachedPrimitiveCheck(primitive) : null;
  if (primitiveCheck && !primitiveCheck.valid) return <div className="registered-component-error" role="alert">Invalid primitive metadata: {primitiveCheck.errors.join('; ')}</div>;
  const accessibility = primitive ? primitiveAccessibilityProps(primitive) : {};
  if (definition.trustedBundled !== true) return <div {...accessibility}
    style={effectiveProps.fillRegion === true ? {height:'100%',minHeight:0,minWidth:0} : undefined}>
    {published}<ComponentSandbox definition={definition} props={effectiveProps} />
  </div>;
  const hydratedDefinition = definition.compiledJs ? definition : asset
    ? {...definition,compiledJs:asset.compiledJs,scopedCss:asset.scopedCss,
      ...((asset.sharedSmartRuntime===true)?{sharedSmartRuntime:true}:{})}
    : null;
  if(!hydratedDefinition)return <div role="alert" className="registered-component-error">Bundled renderer is unavailable.</div>;
  return <div {...accessibility} style={layoutTransparent?{display:'contents'}:undefined}>{published}<ComponentRenderBoundary key={`${definition.apiName}-${definition.version}`}>
    <RegisteredComponentBody definition={hydratedDefinition} props={{...effectiveProps,
      // Host-provided tenant media access is runtime capability, not a saved
      // component setting. Keep it attached to every trusted Smart renderer.
      loadAsset:props.loadAsset,
      readComponent:formulaScope?.read,onFormulaDisplay:setRendered,
      __formulaCode:formulaCodeProp}} appearanceProps={props} layoutTransparent={layoutTransparent} />
  </ComponentRenderBoundary></div>;
}
