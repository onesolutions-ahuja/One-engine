import type {FieldMetadata} from '../../metadata/Definitions/metadata';
type ListKind='FIELD_LIST'|'COLUMNS'|'OPTIONS'|'RECORD_LIST';
type Row=Record<string,unknown>;
export default function StructuredListPropertyEditor({kind,value,fields,label,disabled=false,onChange}:{
 kind:ListKind;value:unknown;fields:readonly FieldMetadata[];label:string;disabled?:boolean;
 onChange:(rows:Row[])=>void;
}){
 const rows:Array<Row>=Array.isArray(value)?value.filter((v):v is Row=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)):[];
 if(kind==='RECORD_LIST')return <div className="form-label"><strong>{label}</strong>
  <p className="properties-help">This collection is populated from an authorised Flow output through Page State, or from a selected Object. Use Flow output → component property to bind the items collection. No JSON entry required.</p>
  <span className="properties-help">{rows.length} saved sample records (preserved)</span></div>;
 const fieldKey=kind==='FIELD_LIST'?'apiName':kind==='COLUMNS'?'key':'value';
 const patch=(i:number,key:string,text:unknown)=>onChange(rows.map((row,j)=>i===j?{...row,[key]:text}:row));
 const valid=/^[A-Za-z][A-Za-z0-9_]*$/;
 return <div className="metadata-component-properties"><strong>{label}</strong>
  {rows.map((row,i)=><div className="metadata-array-property" key={i}>
   <label className="form-label">{kind==='OPTIONS'?'Option value':'Object Field'}
    {kind!=='OPTIONS' && fields.length ? <select className="form-control" disabled={disabled}
      value={String(row[fieldKey]??'')} onChange={event=>{
       const field=fields.find(item=>item.apiName===event.target.value);
       onChange(rows.map((r,j)=>i===j?{...r,[fieldKey]:event.target.value,label:field?.label??event.target.value}:r));
      }}><option value="">Select field…</option>
      {fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}</select>:
     <input className="form-control" disabled={disabled} value={String(row[fieldKey]??'')}
      onChange={event=>{if(kind==='OPTIONS'||!event.target.value||valid.test(event.target.value))patch(i,fieldKey,event.target.value)}}/>}
   </label>
   <label className="form-label">Label<input className="form-control" disabled={disabled}
    value={String(row.label??'')} onChange={event=>patch(i,'label',event.target.value)}/></label>
   {kind==='COLUMNS'&&<label className="form-label">Phone role
     <select className="form-control" disabled={disabled}
       aria-label={'Phone role for '+String(row.label??row.key??('column '+(i+1)))}
       value={String(row.phoneRole??'auto')}
       onChange={event=>{
         const next=event.target.value;
         onChange(rows.map((item,j)=>{
           if(j===i)return next==='auto'?Object.fromEntries(Object.entries(item).filter(([key])=>key!=='phoneRole')):{...item,phoneRole:next};
           if(next!=='auto'&&next!=='hidden'&&item.phoneRole===next)
             return Object.fromEntries(Object.entries(item).filter(([key])=>key!=='phoneRole'));
           return item;
         }));
       }}>
       <option value="auto">Automatic</option>
       <option value="title">Title</option>
       <option value="subtitle">Subtitle</option>
       <option value="badge">Badge</option>
       <option value="trailing">Trailing value</option>
       <option value="hidden">Hide on phone</option>
     </select></label>}
   {kind==='FIELD_LIST'&&<>
    <label className="form-label">Input type<select className="form-control" disabled={disabled}
      value={String(row.inputType??'text')} onChange={event=>patch(i,'inputType',event.target.value)}>
      {['text','number','date','time','email','tel','password'].map(type=><option key={type}>{type}</option>)}
    </select></label>
    <label className="checkbox-row"><input type="checkbox" disabled={disabled}
      checked={row.required===true} onChange={event=>patch(i,'required',event.target.checked)}/>Required</label>
   </>}
   <button className="btn btn-small" type="button" disabled={disabled} onClick={()=>onChange(rows.filter((_,j)=>i!==j))}>Remove</button>
  </div>)}
  <button className="btn btn-small" type="button" disabled={disabled||rows.length>=100}
    onClick={()=>onChange([...rows,kind==='OPTIONS'?{value:'',label:''}:kind==='FIELD_LIST'
      ?{apiName:'',label:'',inputType:'text',required:false}:{key:'',label:''}])}>Add item</button>
 </div>;
}
