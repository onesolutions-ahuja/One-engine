import { appearanceNumberFields, appearanceColorFields, appearanceChoiceFields } from '../../metadata/Definitions/metadataAppearanceSchema';
import { normalizeVisualProperties, type VisualProperties } from '../../pages/TemplatePageRuntime/pageComponentLayout';
import { supportsAppearanceProperty } from './componentAppearanceCapabilities';

/** Visual-first metadata editor used by the shared Page Builder inspector.
 * Presets and exact inputs update the same published visualStyle fields. */
export default function PageComponentVisualEditor({ value, onChange, componentType = '', section = 'all' }: {
  value: unknown; onChange: (next: Partial<VisualProperties>) => void; componentType?: string; section?: 'all' | 'layout' | 'colors' | 'appearance' | 'size';
}) {
  const visual = normalizeVisualProperties(value);
  // Persist only settings actually chosen; normalized defaults are display-only.
  // Otherwise selecting Corners also adds a new padded, borderless outer box.
  const authored = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<VisualProperties> : {};
  const set = <K extends keyof VisualProperties>(key: K, next: VisualProperties[K]) =>
    onChange({ ...authored, [key]: next });
  const setNumber = (key: keyof VisualProperties, next: number) => set(key, next as never);
  const number = (name: keyof VisualProperties, label: string, min: number, max: number) =>
    <label className="form-label" key={name}>{label}
      <input className="form-control" type="number" min={min} max={max}
        value={visual[name] as number}
        onChange={event => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) setNumber(name, Math.max(min, Math.min(max, next)));
        }} />
    </label>;
  const color = (name: 'backgroundColor' | 'color' | 'borderColor', label: string) =>
    <label className="form-label" key={name}>{label}
      <input className="form-control" type="text" placeholder="#ffffff or transparent"
        value={visual[name]} onChange={event => {
          const next = event.target.value;
          if (next === '' || /^(?:#[0-9a-f]{0,8}|[a-z]*)$/i.test(next)) set(name, next);
        }} />
    </label>;
  const numericPresets: Array<{key:'borderRadius'|'padding'|'gap'|'borderWidth';label:string;values:number[];labels:string[]}> = [
    {key:'borderRadius',label:'Corners',values:[0,6,14,28,64],labels:['Square','Small','Round','Soft','Pill']},
    {key:'padding',label:'Inside spacing',values:[0,8,16,24,32],labels:['None','Tight','Normal','Roomy','Wide']},
    {key:'gap',label:'Element spacing',values:[0,4,8,16,24],labels:['None','Tiny','Small','Medium','Large']},
    {key:'borderWidth',label:'Border',values:[0,1,2,4],labels:['None','Hairline','Normal','Bold']}
  ];
  const alignmentPresets: Array<{key:'align'|'justify';label:string;values:readonly string[]}> = [
    {key:'align',label:'Align items',values:['start','center','end','stretch']},
    {key:'justify',label:'Content position',values:['start','center','end','space-between']}
  ];
  const swatches = ['transparent','#ffffff','#f8fafc','#e0e7ff','#dbeafe','#dcfce7','#fee2e2','#111827'];
  return <fieldset className="metadata-component-visual-editor compact-ribbon-visual-editor">
    <legend className="properties-section-title">{section === 'colors' ? 'Component colours' : section === 'appearance' ? 'Appearance' : section === 'size' ? 'Exact size' : 'Appearance & exact size'}</legend>
    <div className="compact-visual-groups">
      {section !== 'colors' && section !== 'size' && numericPresets.filter(preset => supportsAppearanceProperty(componentType, preset.key)).map(preset =>
        <div className="compact-visual-group" key={preset.key}>
          <label className="compact-visual-label">{preset.label}
            <select aria-label={preset.label} value={visual[preset.key]} onChange={event=>setNumber(preset.key,Number(event.target.value))}>
              {preset.values.map((n,index)=><option key={n} value={n}>{preset.labels[index]} · {n}px</option>)}
            </select>
          </label>
          <div className="compact-visual-presets" role="group" aria-label={preset.label}>
            {preset.values.map((n,index)=><button type="button" key={n} title={preset.labels[index]+' · '+n+'px'}
              aria-label={preset.label+': '+preset.labels[index]} aria-pressed={visual[preset.key]===n}
              className={visual[preset.key]===n?'active':''} onClick={()=>setNumber(preset.key,n)}>
              <span className="compact-shape" style={preset.key==='borderRadius'?{borderRadius:Math.min(8,n/3)}:preset.key==='borderWidth'?{borderWidth:Math.max(1,n/2)}:{padding:Math.min(5,n/5)}} />
            </button>)}
          </div>
        </div>)}
      {section !== 'colors' && section !== 'size' && alignmentPresets.filter(preset=>supportsAppearanceProperty(componentType,preset.key)).map(preset=>
        <div className="compact-visual-group" key={preset.key}>
          <label className="compact-visual-label">{preset.label}
            <select value={visual[preset.key]} onChange={event=>set(preset.key,event.target.value as VisualProperties[typeof preset.key])}>
              {preset.values.map(item=><option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>)}
      {(section === 'colors' || section === 'all') && appearanceColorFields.filter(({key})=>supportsAppearanceProperty(componentType,key)).map(({key,label})=>
        <div className="compact-visual-group" key={key}>
          <label className="compact-visual-label">{label}
            <span className="compact-color-controls">
              <input type="color" aria-label={label+' palette'} value={/^#[0-9a-f]{6}$/i.test(visual[key])?visual[key]:'#ffffff'} onChange={event=>set(key,event.target.value)}/>
              <input type="text" aria-label={label+' hex code'} placeholder="#RRGGBB" value={visual[key]}
                onChange={event=>{const next=event.target.value;if(next===''||/^(?:#[0-9a-f]{0,8}|[a-z]*)$/i.test(next))set(key,next);}}/>
            </span>
          </label>
          <div className="compact-color-swatches" role="group" aria-label={label+' presets'}>
            {swatches.map(swatch=><button type="button" key={swatch} aria-label={label+' '+swatch} title={swatch}
              aria-pressed={visual[key].toLowerCase()===swatch} onClick={()=>set(key,swatch)}
              style={{background:swatch==='transparent'?'repeating-conic-gradient(#d5dbe5 0% 25%,white 0% 50%) 50%/8px 8px':swatch}}/>)}
          </div>
        </div>)}
      {(section === 'size' || section === 'layout' || section === 'all') && <section className="compact-visual-group office-ribbon-exact-size" aria-label="Exact size and dimensions">
        <div className="office-ribbon-group-heading">Exact size</div>
        <div className="visual-advanced-grid">
          {appearanceNumberFields.filter(({key}) => supportsAppearanceProperty(componentType, key)).map(({key,label,min,max})=>number(key,label,min,max))}
          {appearanceChoiceFields.filter(({key})=>supportsAppearanceProperty(componentType,key)).map(({key,label,options})=>
            <label className="form-label" key={key}>{label}<select className="form-control" value={visual[key]}
              onChange={event=>set(key,event.target.value as VisualProperties[typeof key])}>
              {options.map(item=><option key={item} value={item}>{item}</option>)}
            </select></label>)}
        </div>
      </section>}
      {(section === 'all' || section === 'layout' || section === 'appearance') && <div className="compact-visual-group"><button type="button" className="btn btn-small" onClick={()=>onChange({})}>Reset appearance</button></div>}
    </div>
  </fieldset>;
}
