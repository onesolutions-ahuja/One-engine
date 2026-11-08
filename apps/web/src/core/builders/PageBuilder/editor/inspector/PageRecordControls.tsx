import SavedListViewPicker from '../../SavedListViewPicker';

import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageEditorState } from '../usePageEditorState';

export default function PageRecordControls({ props, editorState }: {
  props: PageBuilderProps;
  editorState: ReturnType<typeof usePageEditorState>;
}) {
  const { editorMode, objects, page, request } = props;
  const { selected, updateComponent, defaultRelatedLists } = editorState;
  return <>
{editorMode&&selected?.type==='Related List'&&(()=>{
        const names=Array.isArray(selected.properties.relatedLists)
          ?selected.properties.relatedLists.filter((name):name is string=>typeof name==='string'):[];
        const relation=names[0]??'';
        const settings=((selected.properties.relatedListSettings??{}) as Record<string,Record<string,unknown>>);
        const current=settings[relation]??{};
        const setRelatedSetting=(key:string,value:unknown)=>updateComponent(selected.id,{properties:{
          ...selected.properties,relatedListSettings:{...settings,[relation]:{...current,[key]:value}}}});
        return <section className="builder-related-list-settings" aria-label="Related List configuration">
          <label className="form-label">Related list
            <select className="form-control" value={relation}
              onChange={event=>updateComponent(selected.id,{properties:{
                ...selected.properties,relatedLists:[event.target.value]}})}>
              <option value="">Choose relationship</option>
              {[...new Set([...defaultRelatedLists,...names])].map(name=><option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          {relation&&<>
            <label className="form-label"><input type="checkbox"
              checked={selected.properties.serverPaged===true}
              onChange={event=>updateComponent(selected.id,{properties:{
                ...selected.properties,serverPaged:event.target.checked}})}/>
              Independent server-side paging, search and sorting
            </label>
            <label className="form-label">Records per page
              <select className="form-control" value={Number(current.pageSize??25)}
                onChange={event=>setRelatedSetting('pageSize',Number(event.target.value))}>
                {[10,25,50].map(size=><option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <label className="form-label">Sort field
              <input className="form-control" value={String(current.sortField??'')}
                onChange={event=>setRelatedSetting('sortField',event.target.value)} />
            </label>
            <label className="form-label">Filter field
              <input className="form-control" value={String(current.filterField??'')}
                onChange={event=>setRelatedSetting('filterField',event.target.value)} />
            </label>
            <label className="form-label">Filter value
              <input className="form-control" value={String(current.filterValue??'')}
                onChange={event=>setRelatedSetting('filterValue',event.target.value)} />
            </label>
          </>}
        </section>;
      })()}
      {editorMode&&selected?.type==='Record Field'&&(()=>{
        const source=objects.find(item=>item.apiName===page.targetObject);
        const lookupName=String(selected.properties.relatedLookupFieldApiName??'');
        const lookup=source?.fields.find(item=>item.apiName===lookupName&&item.relationship);
        const target=objects.find(item=>item.apiName===lookup?.relationship?.targetObject);
        return <section className="builder-cross-object-settings" aria-label="Cross-object field configuration">
          <label className="form-label">Related record lookup
            <select className="form-control" value={lookupName}
              onChange={event=>updateComponent(selected.id,{properties:{
                ...selected.properties,relatedLookupFieldApiName:event.target.value,relatedFieldApiName:''}})}>
              <option value="">Current record field (no relationship)</option>
              {(source?.fields??[]).filter(item=>Boolean(item.relationship)).map(item=>
                <option key={item.apiName} value={item.apiName}>{item.label}</option>)}
            </select>
          </label>
          {lookup&&<label className="form-label">Related field from {target?.label??lookup.relationship?.targetObject}
            <select className="form-control" value={String(selected.properties.relatedFieldApiName??'')}
              onChange={event=>updateComponent(selected.id,{properties:{
                ...selected.properties,relatedFieldApiName:event.target.value}})}>
              <option value="">Choose a related field</option>
              {(target?.fields??[]).map(item=><option key={item.apiName} value={item.apiName}>{item.label}</option>)}
            </select>
          </label>}
        </section>;
      })()}
      {editorMode&&selected?.type==='Highlights Panel'&&(()=>{
        const source=objects.find(item=>item.apiName===page.targetObject);
        const fields=source?.fields??[];
        const configured=(key:'primaryFieldApiNames'|'secondaryFieldApiNames')=>
          Array.isArray(selected.properties[key])
            ?(selected.properties[key] as unknown[]).filter((name):name is string=>typeof name==='string'):[];
        return <section className="builder-highlights-settings" aria-label="Highlights Panel configuration">
          {(['primaryFieldApiNames','secondaryFieldApiNames'] as const).map(key=>{
            const names=configured(key);
            return <div key={key}>
              <label className="form-label">{key==='primaryFieldApiNames'?'Primary fields':'Secondary fields'}
                <select className="form-control" multiple value={names}
                  onChange={event=>updateComponent(selected.id,{properties:{...selected.properties,
                    [key]:Array.from(event.target.selectedOptions,option=>option.value)}})}>
                  {fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
                </select>
              </label>
              {names.map((name,index)=><div key={name}>
                <span>{fields.find(field=>field.apiName===name)?.label??name}</span>
                <button type="button" disabled={index===0}
                  aria-label={'Move '+name+' up'}
                  onClick={()=>{const updated=[...names];[updated[index-1],updated[index]]=[updated[index],updated[index-1]];
                    updateComponent(selected.id,{properties:{...selected.properties,[key]:updated}});}}>Up</button>
                <button type="button" disabled={index===names.length-1}
                  aria-label={'Move '+name+' down'}
                  onClick={()=>{const updated=[...names];[updated[index+1],updated[index]]=[updated[index],updated[index+1]];
                    updateComponent(selected.id,{properties:{...selected.properties,[key]:updated}});}}>Down</button>
              </div>)}
            </div>;
          })}
        </section>;
      })()}
      {editorMode&&selected?.type==='Path'&&(()=>{
        const source=objects.find(item=>item.apiName===page.targetObject);
        const stage=String(selected.properties.stageFieldApiName??'');
        const field=source?.fields.find(item=>item.apiName===stage);
        const guidance=(selected.properties.guidanceByStage??{}) as Record<string,string>;
        const keys=(selected.properties.keyFieldsByStage??{}) as Record<string,string[]>;
        return <section className="builder-path-settings" aria-label="Path configuration">
          <label className="form-label">Stage field
            <select className="form-control" value={stage}
              onChange={event=>updateComponent(selected.id,{properties:{
                ...selected.properties,stageFieldApiName:event.target.value}})}>
              <option value="">Choose picklist</option>
              {(source?.fields??[]).filter(item=>item.dataType==='Picklist').map(item=>
                <option key={item.apiName} value={item.apiName}>{item.label}</option>)}
            </select>
          </label>
          {(field?.picklistValues??[]).map(value=><div key={value}>
            <label className="form-label">Guidance for {value}
              <input className="form-control" value={guidance[value]??''}
                onChange={event=>updateComponent(selected.id,{properties:{
                  ...selected.properties,guidanceByStage:{...guidance,[value]:event.target.value}}})}/>
            </label>
            <label className="form-label">Key fields for {value}
              <select className="form-control" multiple
                aria-label={'Key fields for '+value} value={keys[value]??[]}
                onChange={event=>updateComponent(selected.id,{properties:{
                  ...selected.properties,keyFieldsByStage:{...keys,
                    [value]:Array.from(event.target.selectedOptions,option=>option.value)}}})}>
                {(source?.fields??[]).map(item=><option key={item.apiName} value={item.apiName}>{item.label}</option>)}
              </select>
            </label>
          </div>)}
        </section>;
      })()}
      {editorMode&&selected?.type==='List View'&&
        <section className="builder-list-view-settings" aria-label="Saved List View block configuration">
          <label className="form-label">Source Object
            <select className="form-control" aria-label="List View Object"
              value={String(selected.properties.listObjectApiName??'')}
              onChange={event=>updateComponent(selected.id,{properties:{
                ...selected.properties,listObjectApiName:event.target.value,savedViewId:''}})}>
              <option value="">Select Object</option>
              {objects.map(item=><option key={item.apiName} value={item.apiName}>{item.pluralLabel}</option>)}
            </select>
          </label>
          <SavedListViewPicker objectApi={String(selected.properties.listObjectApiName??'')}
            savedViewId={String(selected.properties.savedViewId??'')} request={request}
            onChange={id=>updateComponent(selected.id,{properties:{...selected.properties,savedViewId:id}})}/>
        </section>}
  </>;
}
