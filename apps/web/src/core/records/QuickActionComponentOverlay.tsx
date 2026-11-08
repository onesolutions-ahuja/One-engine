import type {LibraryComponentMetadata} from '../metadata/Definitions/metadata';
import RegisteredComponent from '../components/RegisteredComponent/RegisteredComponent';

type Props={
 label:string;
 presentation:'Modal'|'Side Panel';
 definition:LibraryComponentMetadata;
 inputs:Record<string,unknown>;
 onClose:()=>void;
 onLaunchFlow:(apiName:string,inputs?:Record<string,unknown>)=>void;
};

/** Display-only launcher: the server authorizes each action and its target Component. */
export default function QuickActionComponentOverlay({
 label,presentation,definition,inputs,onClose,onLaunchFlow
}:Props){
 return <div className="record-form-backdrop" role="presentation" onMouseDown={event=>{
   if(event.target===event.currentTarget)onClose();
 }}>
   <section className="record-form-dialog surface" role="dialog" aria-modal="true"
     aria-label={label} style={presentation==='Side Panel'
       ?{position:'absolute',right:0,top:0,bottom:0,height:'100%',maxHeight:'100%',width:'min(540px,100%)',borderRadius:0,overflow:'auto'}
       :{width:'min(720px,96vw)',maxHeight:'90vh',overflow:'auto'}}>
     <header><h2>{label}</h2>
       <button type="button" className="icon-button" aria-label="Close component action" onClick={onClose}>×</button>
     </header>
     <RegisteredComponent definition={definition} props={{
       ...inputs,
       actionContext:'QuickAction',
       onClose,
       onLaunchFlow
     }}/>
   </section>
 </div>;
}
