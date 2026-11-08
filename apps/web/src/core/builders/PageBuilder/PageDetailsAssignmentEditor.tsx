import {useState} from 'react';
import type {
 LightningAppMetadata,LightningPageMetadata,PageActivationAssignmentMetadata,ProfileMetadata
} from '../../metadata/Definitions/metadata';

type Assignment=PageActivationAssignmentMetadata;
type Factor=Assignment['formFactors'][number];
type RecordType={id:string;label:string;active:boolean};
type Props={
 page:LightningPageMetadata;
 apps:readonly LightningAppMetadata[];
 profiles:readonly ProfileMetadata[];
 recordTypes:readonly RecordType[];
 assignments:Assignment[];
 onChange:(next:Assignment[])=>void;
 disabled:boolean;
};
const devices:Factor[]=['Desktop','Phone','Tablet','Custom'];
const requiresProfile=(scope:Assignment['scope'])=>
 scope==='App and Profile'||scope==='App, Record Type, and Profile';
const requiresApp=(scope:Assignment['scope'])=>scope!=='Org Default';
const requiresType=(scope:Assignment['scope'])=>scope==='App, Record Type, and Profile';
const overlaps=(a:Assignment,b:Assignment)=>a.id!==b.id&&a.scope===b.scope
 &&a.appId===b.appId&&a.profileId===b.profileId&&a.recordTypeId===b.recordTypeId
 &&a.formFactors.some(factor=>b.formFactors.includes(factor));

export function assignmentValidationError(page:LightningPageMetadata,assignments:readonly Assignment[],
 apps:readonly LightningAppMetadata[],profiles:readonly ProfileMetadata[],recordTypes:readonly RecordType[]):string{
 for(const assignment of assignments){
  if(page.pageType==='Home Page'&&!['App Default','App and Profile'].includes(assignment.scope))
   return 'Invalid Home Page assignment type.';
  if(page.pageType==='Record Page'&&!['Org Default','App Default','App and Profile','App, Record Type, and Profile'].includes(assignment.scope))
   return 'Invalid Record Page assignment type.';
  if(requiresApp(assignment.scope)&&!apps.some(app=>app.apiName===assignment.appId))
   return 'Select an installed application for each assignment.';
  if(requiresProfile(assignment.scope)&&!profiles.some(profile=>profile.id===assignment.profileId))
   return 'Select a valid profile for each profile-specific assignment.';
  if(requiresType(assignment.scope)&&!recordTypes.some(type=>type.id===assignment.recordTypeId&&type.active))
   return 'Select an active record type for each record-type assignment.';
  if(!assignment.formFactors.length||assignment.formFactors.some(factor=>
   !devices.includes(factor)||(factor==='Desktop'||factor==='Phone')&&!page.devices.includes(factor)))
   return 'Choose at least one supported device for every assignment.';
  if(assignments.some(other=>overlaps(assignment,other)))
   return 'Overlapping assignments exist for the same app, profile, record type and device.';
 }
 return '';
}

/** Page-level activation metadata, not a component property or an alternative RBAC engine. */
export default function PageDetailsAssignmentEditor({page,apps,profiles,recordTypes,
 assignments,onChange,disabled}:Props){
 const home=page.pageType==='Home Page';
 const [scope,setScope]=useState<Assignment['scope']>(home?'App Default':'Org Default');
 const [appId,setAppId]=useState('');
 const [profileId,setProfileId]=useState('');
 const [recordTypeId,setRecordTypeId]=useState('');
 const [formFactors,setFormFactors]=useState<Factor[]>(page.devices.includes('Desktop')?['Desktop']:
  page.devices.includes('Phone')?['Phone']:['Tablet']);
 const [error,setError]=useState('');
 const update=(id:string,patch:Partial<Assignment>)=>{
  setError('');onChange(assignments.map(assignment=>assignment.id===id?{...assignment,...patch}:assignment));
 };
 const add=()=>{
  const next:Assignment={
   id:'page-assignment-'+crypto.randomUUID(),scope,
   appId:requiresApp(scope)?appId:null,
   profileId:requiresProfile(scope)?profileId:null,
   recordTypeId:requiresType(scope)?recordTypeId:null,
   formFactors:devices.filter(factor=>formFactors.includes(factor)
    &&(factor==='Tablet'||factor==='Custom'||page.devices.includes(factor)))
  };
  const message=assignmentValidationError(page,[...assignments,next],apps,profiles,recordTypes);
  if(message){setError(message);return;}
  setError('');onChange([...assignments,next]);
 };
 return <div className="page-details-assignment-editor" aria-label="Page activation assignments">
  {assignments.map(assignment=><div key={assignment.id} className="page-details-assignment-row">
   <strong>{assignment.scope}</strong>
   {requiresApp(assignment.scope)&&<label className="form-label">Application
    <select className="form-control" aria-label={'Assignment app '+assignment.id} disabled={disabled}
     value={assignment.appId??''} onChange={e=>update(assignment.id,{appId:e.target.value})}>
     <option value="">Select installed app…</option>
     {apps.map(app=><option key={app.apiName} value={app.apiName}>{app.label} ({app.apiName})</option>)}
    </select></label>}
   {requiresProfile(assignment.scope)&&<label className="form-label">Profile
    <select className="form-control" aria-label={'Assignment profile '+assignment.id} disabled={disabled}
     value={assignment.profileId??''} onChange={e=>update(assignment.id,{profileId:e.target.value})}>
     <option value="">Select profile…</option>
     {profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.label}</option>)}
    </select></label>}
   {requiresType(assignment.scope)&&<small>Record type: {recordTypes.find(type=>type.id===assignment.recordTypeId)?.label??assignment.recordTypeId}</small>}
   <small>Devices: {assignment.formFactors.join(', ')}</small>
   <button className="btn btn-small" type="button" disabled={disabled}
    aria-label={'Remove activation assignment '+assignment.id}
    onClick={()=>{setError('');onChange(assignments.filter(item=>item.id!==assignment.id));}}>Remove</button>
  </div>)}
  <div className="page-details-assignment-new">
   <label className="form-label">Assign as
    <select className="form-control" aria-label="Assignment scope" disabled={disabled}
     value={scope} onChange={e=>{setScope(e.target.value as Assignment['scope']);setError('');}}>
     {!home&&<option value="Org Default">Org Default</option>}
     <option value="App Default">App Default</option>
     <option value="App and Profile">App and Profile</option>
     {!home&&recordTypes.some(type=>type.active)&&<option value="App, Record Type, and Profile">App, Record Type, and Profile</option>}
    </select>
   </label>
   {requiresApp(scope)&&<label className="form-label">App selection
    <select className="form-control" aria-label="New assignment app" disabled={disabled}
     value={appId} onChange={e=>setAppId(e.target.value)}>
     <option value="">Select installed app…</option>
     {apps.map(app=><option key={app.apiName} value={app.apiName}>{app.label} ({app.apiName})</option>)}
    </select></label>}
   {requiresProfile(scope)&&<label className="form-label">Role / Profile
    <select className="form-control" aria-label="New assignment profile" disabled={disabled}
     value={profileId} onChange={e=>setProfileId(e.target.value)}>
     <option value="">Select profile…</option>
     {profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.label}</option>)}
    </select></label>}
   {requiresType(scope)&&<label className="form-label">Record type
    <select className="form-control" aria-label="New assignment record type" disabled={disabled}
     value={recordTypeId} onChange={e=>setRecordTypeId(e.target.value)}>
     <option value="">Select record type…</option>
     {recordTypes.filter(type=>type.active).map(type=><option key={type.id} value={type.id}>{type.label}</option>)}
    </select></label>}
   <div className="page-details-assignment-devices" role="group" aria-label="Assignment devices">
    {devices.map(factor=><label key={factor}>
     <input type="checkbox" disabled={disabled||(factor==='Desktop'||factor==='Phone')&&!page.devices.includes(factor)}
      checked={formFactors.includes(factor)}
      onChange={e=>setFormFactors(current=>e.target.checked?[...current,factor]:current.filter(item=>item!==factor))}/>
     {factor}
    </label>)}
   </div>
   <button type="button" className="btn btn-small" disabled={disabled} onClick={add}>
    Add activation assignment
   </button>
  </div>
  {error&&<p role="alert" className="page-details-error">{error}</p>}
  <small>Save Changes to store these assignments in the page draft. Published activation remains unchanged until publishing.</small>
 </div>;
}
