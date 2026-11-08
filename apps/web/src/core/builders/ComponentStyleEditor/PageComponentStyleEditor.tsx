import {responsiveNumberFields,responsiveOptionFields,responsiveColorFields} from '../../metadata/Definitions/metadataAppearanceSchema';
import { useState } from 'react';
import { componentAppearanceCapabilities, supportsAppearanceProperty } from './componentAppearanceCapabilities';
import {
  layoutSettings,
  updateLayoutSettings,
  validateLayoutSetting,
  type LayoutDevice,
  type LayoutSettingKey
} from '../../pages/TemplatePageRuntime/pageComponentLayout';

type Mode = 'Base' | LayoutDevice;
const numeric: Array<[LayoutSettingKey,string,number,number]> =
  responsiveNumberFields.map(({key,label,min,max})=>[key,label,min,max]);
const typography: Array<[LayoutSettingKey,string,readonly string[]]> =
  responsiveOptionFields.filter(({key})=>['fontWeight','textAlign','boxShadow'].includes(key))
    .map(({key,label,options})=>[key,label,options]);
const alignments: Array<[LayoutSettingKey,string,readonly string[]]> =
  responsiveOptionFields.filter(({key})=>['alignItems','justifyContent'].includes(key))
    .map(({key,label,options})=>[key,label,options]);

export default function PageComponentStyleEditor({
  properties, onChange, disabled = false, componentType = '', section = 'all'
}: {
  properties: Record<string, unknown>;
  onChange: (properties: Record<string, unknown>) => void;
  disabled?: boolean;
  componentType?: string;
  section?: 'all' | 'layout' | 'colors';
}) {
  const [mode, setMode] = useState<Mode>('Base');
  const [error, setError] = useState('');
  const base = properties.layoutStyle && typeof properties.layoutStyle === 'object'
    ? properties.layoutStyle as Record<string, unknown> : {};
  const overrides = properties.layoutResponsive && typeof properties.layoutResponsive === 'object'
    ? properties.layoutResponsive as Record<string, Record<string, unknown>> : {};
  const current = mode === 'Base' ? base : overrides[mode] ?? {};
  const inherited = layoutSettings(properties, mode === 'Base' ? 'Desktop' : mode);
  const change = (key: LayoutSettingKey, value: string | number | boolean | null) => {
    if (disabled) return;
    const validation = value === null ? '' : validateLayoutSetting(key, value);
    if (validation) { setError(`${key}: ${validation}`); return; }
    setError('');
    onChange(updateLayoutSettings(properties, mode, key, value));
  };
  const inheritedCaption = mode === 'Base' ? 'Default' : 'Inherit base';
  // Metadata controls are partitioned into genuine three-row ribbon groups;
  // long lists flow horizontally instead of stacking into overlapping rows.
  const numberFields = section === 'colors' ? [] : numeric.filter(([key])=>supportsAppearanceProperty(componentType,key));
  const alignFields = section === 'all' || section === 'layout'
    ? alignments.filter(([key])=>supportsAppearanceProperty(componentType,key)) : [];
  const numberGroups: Array<{title:string;items:typeof numberFields}> = [
    {title:'Responsive size',items:numberFields.filter(([key])=>/^(?:width|height|minWidth|maxWidth|minHeight|maxHeight)$/.test(key))},
    {title:'Responsive spacing',items:numberFields.filter(([key])=>/padding|margin|gap/.test(key))},
    {title:'Responsive borders',items:numberFields.filter(([key])=>/border|radius/.test(key))},
    {title:'Responsive position',items:numberFields.filter(([key])=>/top|bottom|left|right|offset|zIndex/.test(key))},
    {title:'Responsive effects',items:numberFields.filter(([key])=>/opacity|overflow/.test(key))}
  ];
  const known=new Set(numberGroups.flatMap(group=>group.items.map(([key])=>key)));
  const other=numberFields.filter(([key])=>!known.has(key));
  if(other.length)numberGroups.push({title:'Responsive options',items:other});
  const renderNumeric=([key,label,min,max]:(typeof numeric)[number])=><label key={key} className="form-label">
    <span>{label}{key==='opacity'?' (%)':''}</span>
    <input className="form-control" type="number" aria-label={label}
      disabled={disabled} min={min} max={max} step={1}
      placeholder={String(inherited[key]??inheritedCaption)}
      value={typeof current[key]==='number'?current[key] as number:''}
      onChange={event=>{
        if(!event.target.value)return change(key,null);
        const value=Number(event.target.value);
        if(Number.isFinite(value))change(key,value);
      }}/>
  </label>;
  return <section className="page-component-style-editor office-ribbon-responsive-editor"
    aria-label={section==='colors'?'Responsive colours':'Advanced layout and responsive properties'}>
    <div className="office-ribbon-responsive-group office-ribbon-device-group">
      <label className="form-label"><span>Device</span>
        <select className="form-control" aria-label="Edit layout breakpoint" disabled={disabled}
          value={mode} onChange={event=>setMode(event.target.value as Mode)}>
          <option value="Base">Base / default</option>
          <option value="Desktop">Desktop</option>
          <option value="Tablet">Tablet</option>
          <option value="Phone">Phone</option>
        </select>
      </label>
      <div className="office-ribbon-group-heading">Device</div>
    </div>
    {numberGroups.flatMap(group=>Array.from({length:Math.ceil(group.items.length/3)},(_,index)=>
      <div className="office-ribbon-responsive-group" key={group.title+index}>
        {group.items.slice(index*3,index*3+3).map(renderNumeric)}
        <div className="office-ribbon-group-heading">{group.title}{index? ' '+(index+1):''}</div>
      </div>))}
    {alignFields.length>0 && <div className="office-ribbon-responsive-group">
      {alignFields.map(([key,label,options])=><label className="form-label" key={key}><span>{label}</span>
        <select className="form-control" aria-label={label} disabled={disabled}
          value={String(current[key]??'')} onChange={event=>change(key,event.target.value||null)}>
          <option value="">{inheritedCaption}</option>
          {options.map(item=><option key={item} value={item}>{item.replace('-', ' ')}</option>)}
        </select>
      </label>)}
      <div className="office-ribbon-group-heading">Responsive alignment</div>
    </div>}
    {section!=='layout' && responsiveColorFields.filter(({key})=>supportsAppearanceProperty(componentType,key))
      .map(({key,label})=>{
        const chosen=String(current[key]??inherited[key]??'#ffffff');
        return <div key={key} className="office-ribbon-responsive-group office-ribbon-color-group">
          <label className="form-label"><span>{label}</span>
            <input type="color" aria-label={label+' picker'} disabled={disabled}
              value={/^#[0-9a-f]{6}$/i.test(chosen)?chosen:'#ffffff'}
              onChange={event=>change(key,event.target.value)}/>
          </label>
          <label className="checkbox-row"><input type="checkbox" disabled={disabled}
            checked={chosen==='transparent'}
            onChange={event=>change(key,event.target.checked?'transparent':'#ffffff')}/> Transparent</label>
          {mode!=='Base'&&<button type="button" className="btn btn-small" disabled={disabled}
            onClick={()=>change(key,null)}>Inherit base</button>}
          <div className="office-ribbon-group-heading">{label}</div>
        </div>;
      })}
    {section==='all' && typography.filter(([key])=>supportsAppearanceProperty(componentType,key)).map(([key,label,options])=>
      <div key={key} className="office-ribbon-responsive-group"><label className="form-label"><span>{label}</span>
        <select className="form-control" disabled={disabled} value={String(current[key]??'')}
          onChange={event=>change(key,event.target.value||null)}>
          <option value="">{inheritedCaption}</option>
          {options.map(item=><option key={item} value={item}>{item}</option>)}
        </select></label><div className="office-ribbon-group-heading">{label}</div>
      </div>)}
    {section==='all' && <div className="office-ribbon-responsive-group">
      <label className="form-label"><span>Visibility</span><select className="form-control"
        disabled={disabled} aria-label="Component visibility"
        value={current.hidden===true?'hidden':current.hidden===false?'visible':'inherit'}
        onChange={event=>change('hidden',event.target.value==='inherit'?null:event.target.value==='hidden')}>
        <option value="inherit">{mode==='Base'?'Visible by default':'Inherit base'}</option>
        <option value="visible">Visible</option><option value="hidden">Hidden</option>
      </select></label>
      {(!componentType||componentAppearanceCapabilities(componentType).container)&&
        <label className="checkbox-row"><input type="checkbox" disabled={disabled}
          aria-label="Allow nested components" checked={properties.layoutContainer!==false}
          onChange={event=>onChange({...properties,layoutContainer:event.target.checked})}/>
          Allow child components</label>}
      <div className="office-ribbon-group-heading">Visibility</div>
    </div>}
    {error&&<div className="auth-error" role="alert">{error}</div>}
  </section>;
}
