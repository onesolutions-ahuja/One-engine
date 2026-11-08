import type {
  ObjectMetadata, RoleMetadata, UserMetadata,
  RestrictionRuleMetadata, SharingSettingMetadata
} from '../../metadata/Definitions/metadata';

type Props={
  tenantId:string;
  object:ObjectMetadata;
  setting:SharingSettingMetadata;
  users:UserMetadata[];
  roles:RoleMetadata[];
  onChange:(value:SharingSettingMetadata)=>void;
};
const operators=[
  ['eq','Equals'],['ne','Not equals'],['in','In list'],
  ['notIn','Not in list'],['isNull','Is null'],['notNull','Is not null']
] as const;
export default function AdvancedSharingSettings({
  tenantId,object,setting,users,roles,onChange
}:Props){
  const rules=setting.restrictionRules??[];
  const fields=[{apiName:'Id',label:'Record ID'},...object.fields];
  const change=(index:number,patch:Partial<RestrictionRuleMetadata>)=>{
    onChange({...setting,restrictionRules:rules.map((rule,i)=>i===index?{...rule,...patch}:rule)});
  };
  const addRule=()=>{
    if(!tenantId||rules.length>=100) return;
    onChange({...setting,restrictionRules:[...rules,{
      id:'restriction_'+crypto.randomUUID().replace(/-/g,'').slice(0,18),
      tenantId,objectApiName:object.apiName,enabled:true,subjectType:'all',
      conditionLogic:'all',conditions:[{field:fields[0].apiName,operator:'eq',value:''}]
    }]});
  };
  return <section aria-label={object.label+' advanced sharing'} className="permission-section">
    <div className="section-toolbar">
      <div><h3>Advanced sharing — {object.label}</h3>
        <p>Restriction rules narrow record access, including ownership and administrator-wide record grants.</p>
      </div>
      <button type="button" className="btn" onClick={addRule} disabled={!tenantId||rules.length>=100}>
        Add restriction rule
      </button>
    </div>
    <div className="settings-grid">
      <label className="form-label">
        <input type="checkbox" checked={setting.portalEnabled===true}
          onChange={e=>onChange({...setting,portalEnabled:e.target.checked,
            portalAccountField:setting.portalAccountField??(fields.some(field=>field.apiName==='AccountId')?'AccountId':'Id')})}/>
        Allow explicitly scoped external portal records
      </label>
      <label className="form-label">Portal account relationship field
        <select className="form-control" value={setting.portalAccountField??(fields.some(field=>field.apiName==='AccountId')?'AccountId':'Id')}
          onChange={e=>onChange({...setting,portalAccountField:e.target.value})}>
          {fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
        </select>
      </label>
    </div>
    <p className="permission-help">External users are denied by default and must match their verified account boundary. Portal users cannot access tenant Setup or modify records.</p>
    {rules.map((rule,index)=><div className="settings-card" key={rule.id}>
      <div className="section-toolbar">
        <strong>Restriction {index+1}</strong>
        <button type="button" className="btn" onClick={()=>onChange({
          ...setting,restrictionRules:rules.filter((_,i)=>i!==index)
        })}>Remove</button>
      </div>
      <div className="settings-grid">
        <label className="form-label"><input type="checkbox" checked={rule.enabled}
          onChange={e=>change(index,{enabled:e.target.checked})}/> Enabled</label>
        <label className="form-label">Applies to
          <select className="form-control" value={rule.subjectType}
            onChange={e=>change(index,{subjectType:e.target.value as RestrictionRuleMetadata['subjectType'],
              subjectId:undefined})}>
            <option value="all">All users</option>
            <option value="user">One user</option>
            <option value="role">Role</option>
            <option value="external">External portal users</option>
          </select>
        </label>
        {(rule.subjectType==='user'||rule.subjectType==='role')&&
          <label className="form-label">Target
            <select className="form-control" value={rule.subjectId??''}
              onChange={e=>change(index,{subjectId:e.target.value})}>
              <option value="">Select target</option>
              {(rule.subjectType==='user'
                ? users.map(user=>({id:user.id,label:user.name}))
                : roles.map(role=>({id:role.id,label:role.name}))).map(item=>
                  <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>}
        <label className="form-label">Conditions
          <select className="form-control" value={rule.conditionLogic}
            onChange={e=>change(index,{conditionLogic:e.target.value as 'all'|'any'})}>
            <option value="all">All must match</option>
            <option value="any">Any may match</option>
          </select>
        </label>
      </div>
      {rule.conditions.map((condition,ci)=><div key={ci} className="settings-grid">
        <label className="form-label">Field
          <select className="form-control" value={condition.field}
            onChange={e=>change(index,{conditions:rule.conditions.map((c,i)=>
              i===ci?{...c,field:e.target.value}:c)})}>
            {fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
          </select>
        </label>
        <label className="form-label">Operator
          <select className="form-control" value={condition.operator}
            onChange={e=>change(index,{conditions:rule.conditions.map((c,i)=>
              i===ci?{...c,operator:e.target.value as typeof c.operator}:c)})}>
            {operators.map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {!['isNull','notNull'].includes(condition.operator)&&
          <label className="form-label">Value
            <input className="form-control" value={Array.isArray(condition.value)?condition.value.join(','):String(condition.value??'')}
              onChange={e=>change(index,{conditions:rule.conditions.map((c,i)=>
                i===ci?{...c,value:(c.operator==='in'||c.operator==='notIn')
                  ?e.target.value.split(',').map(value=>value.trim()).filter(Boolean):e.target.value}:c)})}/>
          </label>}
        <button type="button" className="btn" disabled={rule.conditions.length===1}
          onClick={()=>change(index,{conditions:rule.conditions.filter((_,i)=>i!==ci)})}>
          Remove condition
        </button>
      </div>)}
      <button type="button" className="btn" disabled={rule.conditions.length>=16}
        onClick={()=>change(index,{conditions:[...rule.conditions,{
          field:fields[0].apiName,operator:'eq',value:''
        }]})}>Add condition</button>
    </div>)}
  </section>;
}
