import type {FieldMetadata,ObjectMetadata} from '../../metadata/Definitions/metadata';
import RibbonFieldExpressionInput from '../PageBuilder/RibbonFieldExpressionInput';
import type {LibraryComponentMetadata} from '../../metadata/Definitions/metadata';
import TenantMediaPicker from './TenantMediaPicker';
import RibbonColorPalette from '../PageBuilder/RibbonColorPalette';
import {groupedPresentationProperties, presentationValue} from './presentationPropertyModel.mjs';

type Properties = Record<string, unknown>;
type Definitions = LibraryComponentMetadata['propertyDefinitions'];

/** Editing tab: render declared text, layout and appearance defaults before any data binding exists. */
export default function ComponentPresentationProperties({
  definitions, properties, onChange, expressionFields, objects=[], objectApiName=''
}: {
  definitions?: Definitions;
  properties: Properties;
  onChange: (next: Properties) => void;
  expressionFields?: FieldMetadata[];
  objects?: readonly ObjectMetadata[];objectApiName?:string;
}) {
  const groups = groupedPresentationProperties(definitions ?? []);
  const update = (key: string, value: unknown) => onChange({...properties, [key]: value});
  const clear = (key: string) => {
    const next = {...properties};
    delete next[key];
    onChange(next);
  };
  if (!groups.length) return null;
  return <div className="metadata-component-presentation" aria-label="Content and appearance settings">
    {groups.flatMap(group => Array.from({length:Math.ceil(group.definitions.length/3)},(_,index)=><section key={group.section+'-'+index} className="office-ribbon-presentation-group">
      <div className="office-ribbon-group-heading">{group.section}{index>0?' '+(index+1):''}</div>
      {group.definitions.slice(index*3,index*3+3).map(definition => {
        const key = definition.propertyKey;
        const value = presentationValue(properties, definition);
        const label = definition.label || key.replace(/([a-z])([A-Z])/g, '$1 $2');
        if (definition.kind === 'IMAGE') return <div key={key} className="form-label">
          <label>{label}</label>
          <TenantMediaPicker value={String(value ?? '')} onChange={next => update(key, next)} />
        </div>;
        if (definition.kind === 'SELECT' && /(?:heading|description|badge|value)FontWeight$/i.test(key) && definition.choices?.length)
          return <div key={key} className="form-label office-ribbon-metadata-weight">
            <span>{label}</span>
            <div className="office-ribbon-weight-choices">
              {definition.choices.map(choice=><button key={choice.key} type="button"
                title={choice.label} aria-label={label+': '+choice.label}
                aria-pressed={String(value??'')===String(choice.key)}
                style={{fontWeight:Number(choice.key)||400}}
                onClick={()=>update(key,choice.key)}>B</button>)}
            </div>
          </div>;
        if (definition.kind === 'SELECT' && definition.choices?.length) return <label key={key} className="form-label">
          {label}
          <select className="form-control" aria-label={label} value={String(value ?? '')}
            onChange={event => update(key, event.target.value)}>
            <option value="">Default / none</option>
            {definition.choices.map(choice =>
              <option key={choice.key} value={choice.key}>{choice.label}</option>)}
          </select>
        </label>;
        if (definition.kind === 'BOOLEAN') return <label key={key} className="checkbox-row">
          <input type="checkbox" checked={value === true}
            onChange={event => update(key, event.target.checked)}/>
          {label}
        </label>;
        if (definition.kind === 'COLOR') return <div key={key} className="form-label office-ribbon-metadata-color">
          <span>{label}</span>
          <RibbonColorPalette kind={/border/i.test(key)?'border':/background|fill|accent/i.test(key)?'fill':'text'}
            label={label} value={String(value??'')} onChange={next=>update(key,next)}/>
        </div>;
        if (definition.kind === 'NUMBER' && /(?:heading|description|badge|value)FontSize$/i.test(key))
          return <label key={key} className="form-label office-ribbon-metadata-size">{label}
            <input className="form-control" aria-label={label} type="number" min={8} max={96}
              value={typeof value==='number'?value:''}
              onChange={event=>event.target.value===''?clear(key):update(key,Number(event.target.value))}/>
          </label>;
        if (definition.kind === 'NUMBER' || definition.kind === 'CURRENCY') return <label key={key} className="form-label">
          {label}
          <input className="form-control" aria-label={label} type="number"
            value={typeof value === 'number' ? value : ''}
            onChange={event => event.target.value === '' ? clear(key) : update(key, Number(event.target.value))}/>
        </label>;
        if(expressionFields && ['TEXT','LONG_TEXT','TEXTAREA','STRING'].includes(definition.kind))
          return <div key={key} className="office-ribbon-text-expression">
            <RibbonFieldExpressionInput label={label} value={String(value??'')} fields={expressionFields} objects={objects} objectApiName={objectApiName} onChange={text=>update(key,text)}/>
          </div>;
        return <label key={key} className="form-label">
          {label}
          <input className="form-control" aria-label={label} type="text"
            value={String(value ?? '')} onChange={event => update(key, event.target.value)}/>
        </label>;
      })}
    </section>))}
  </div>;
}
