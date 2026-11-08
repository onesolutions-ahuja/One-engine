import {lazy,Suspense,useState,type FormEvent} from 'react';
import type {FlowElementMetadata,LibraryComponentMetadata} from '../../metadata/Definitions/metadata';
import {initialScreenValues,screenFieldIsVisible} from '../../automation/FlowScreen/flowScreenRuntimeUtils';

// Reuse the exact Flow Screen renderer and server interview runtime used in Setup.
const FlowScreenContent=lazy(()=>import('../../automation/FlowScreen/FlowScreenContent'));
type FlowState={
  interviewId:string;
  screen:FlowElementMetadata;
  values:Record<string,unknown>;
  screenResources:Record<string,unknown>;
  outcomes:Array<{name:string;label:string}>;
  canGoBack:boolean;
};
type Response={
  interviewId?:string;screen?:FlowElementMetadata;
  values?:Record<string,unknown>;screenResources?:Record<string,unknown>;
  outcomes?:Array<{name:string;label:string}>;canGoBack?:boolean;
  outputs?:Record<string,unknown>;
};
const fromResponse=(result:Response):FlowState|null=>result.interviewId&&result.screen
  ?{interviewId:result.interviewId,screen:result.screen,
    values:{...initialScreenValues(result.screen),...(result.values??{})},
    screenResources:result.screenResources??{},
    outcomes:result.outcomes??[{name:'Default',label:'Next'}],
    canGoBack:result.canGoBack===true}:null;
export default function EmbeddedScreenFlow({
  label,flowApiName,flows,request,libraryComponents,recordId,inputRecordIdAs,onFinished
}:{
  label:string;flowApiName:string;
  flows:ReadonlyArray<{apiName:string;status:string;flowType:string}>;
  request:<T>(path:string,init?:RequestInit)=>Promise<T>;
  libraryComponents:LibraryComponentMetadata[];
  recordId?:string;inputRecordIdAs?:string;
  onFinished?:()=>void;
}) {
  const [interview,setInterview]=useState<FlowState|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const flow=flows.find(item=>item.apiName===flowApiName);
  const available=flow?.status==='Active'&&['Screen Flow','In-Screen Flow'].includes(flow.flowType);
  const process=(result:Response)=>{
    const next=fromResponse(result);
    setInterview(next);
    if(!next){
      if(result.interviewId){
        setMessage('Flow is waiting; resume it from Pending Work.');
      }else{
        setMessage('Flow completed.');
        onFinished?.();
      }
    }
  };
  const start=async()=>{
    if(!available)return;
    setError('');setMessage('');setBusy(true);
    try{
      const inputs=recordId&&inputRecordIdAs&&/^[A-Za-z][A-Za-z0-9_]*$/.test(inputRecordIdAs)
        ?{[inputRecordIdAs]:recordId}:{};
      process(await request<Response>('/flows/'+encodeURIComponent(flowApiName)+'/execute',{
        method:'POST',body:JSON.stringify(inputs)
      }));
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Unable to launch Screen Flow');
    }finally{setBusy(false);}
  };
  const transition=async(action:'next'|'back',outcome?:string)=>{
    if(!interview)return;
    setError('');setBusy(true);
    try{
      const result=await request<Response>('/flow-interviews/'+encodeURIComponent(interview.interviewId)+'/next',{
        method:'POST',body:JSON.stringify(action==='back'?{action:'back'}:{
          values:interview.values,...(outcome?{outcome}:{})
        })
      });
      process(result);
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Unable to continue Screen Flow');
    }finally{setBusy(false);}
  };
  const renderScreen=interview?.screen;
  return <section className="record-fields-card surface" aria-label={label}>
    <div className="record-fields-heading"><h2>{label}</h2></div>
    {!interview&&<button type="button" className="btn btn-brand" disabled={!available||busy}
      onClick={()=>void start()}>{busy?'Starting…':'Start '+label}</button>}
    {!available&&<p role="status">Select an active Screen Flow in block settings.</p>}
    {message&&<p role="status">{message}</p>}
    {error&&<p role="alert">{error}</p>}
    {interview&&renderScreen&&<form onSubmit={(event:FormEvent<HTMLFormElement>)=>{
      event.preventDefault();
      const submitter=(event.nativeEvent as SubmitEvent).submitter;
      const outcome=submitter instanceof HTMLButtonElement?submitter.value:'';
      void transition('next',outcome);
    }}>
      <h3>{renderScreen.label}</h3>
      <div className={'flow-screen-grid'+(renderScreen.config.layout==='Two Columns'?' flow-screen-grid-two':'')}>
        <Suspense fallback={<p role="status">Loading screen fields…</p>}>
          <FlowScreenContent
            fields={Array.isArray(renderScreen.config.fields)
              ?renderScreen.config.fields as Array<Record<string,unknown>>:[]}
            libraryComponents={libraryComponents}
            interviewId={interview.interviewId}
            values={{...interview.screenResources,...interview.values}}
            onValueChange={(name,value)=>setInterview(current=>current?{
              ...current,values:{...current.values,[name]:value}}:current)}
            loadRecords={async(objectApi)=>{
              const result=await request<{records:Array<Record<string,unknown>>}>(
                '/records/'+encodeURIComponent(objectApi)+'?limit=100');
              return result.records??[];
            }}
            onError={setError}
            isFieldVisible={screenFieldIsVisible}
          />
        </Suspense>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" disabled={busy}
          onClick={()=>{setInterview(null);setMessage('Interview closed.');}}>Close</button>
        {interview.canGoBack&&<button type="button" className="btn" disabled={busy}
          onClick={()=>void transition('back')}>Previous</button>}
        {interview.outcomes.map(outcome=><button key={outcome.name} type="submit"
          value={outcome.label} className="btn btn-brand" disabled={busy}>
          {busy?'Continuing…':outcome.label}
        </button>)}
      </div>
    </form>}
  </section>;
}
