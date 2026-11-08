import {resolveScreenText} from './flowScreenRuntimeUtils';
import {findRegisteredComponent, findRegisteredComponentForInstance} from '../../components/Registry/componentRegistryLookup';
import { lazy, Suspense, useEffect, useState } from 'react';
import { componentLayoutProps, resolveLayoutStyle, type LayoutDevice } from '../../pages/TemplatePageRuntime/pageComponentLayout';
// Lookup, upload and table implementations load only when the screen contains them.
const FlowScreenAdvancedField = lazy(() => import('./FlowScreenAdvancedField'));
import RegisteredComponent from '../../components/RegisteredComponent/RegisteredComponent';
import type { LibraryComponentMetadata } from '../../metadata/Definitions/metadata';

type ScreenField = Record<string, unknown>;
type ScreenRecord = Record<string, unknown>;

type FlowScreenContentProps = {
  fields: ScreenField[];
  libraryComponents: LibraryComponentMetadata[];
  interviewId: string;
  values: Record<string, unknown>;
  onValueChange: (name: string, value: unknown) => void;
  loadRecords: (objectApiName: string) => Promise<ScreenRecord[]>;
  onError: (message: string) => void;
  isFieldVisible: (field: ScreenField, values: Record<string, unknown>) => boolean;
};

function fieldName(field: ScreenField, index: number): string {
  return typeof field.apiName === 'string'
    ? field.apiName
    : String(field.label ?? `Field_${index + 1}`).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export default function FlowScreenContent({
  fields,
  libraryComponents,
  interviewId,
  values,
  onValueChange,
  loadRecords,
  onError,
  isFieldVisible
}: FlowScreenContentProps) {
  const [layoutDevice, setLayoutDevice] = useState<LayoutDevice>(() =>
    window.innerWidth <= 640 ? 'Phone' : window.innerWidth <= 1024 ? 'Tablet' : 'Desktop');
  useEffect(() => {
    const onResize = () => setLayoutDevice(window.innerWidth <= 640 ? 'Phone' : window.innerWidth <= 1024 ? 'Tablet' : 'Desktop');
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const groups: Array<{ section: ScreenField | null; fields: Array<{ field: ScreenField; index: number }> }> = [];
  let current: { section: ScreenField | null; fields: Array<{ field: ScreenField; index: number }> } = { section: null, fields: [] };
  fields.forEach((field, index) => {
    if (field.type === 'Section') {
      if (current.section || current.fields.length) groups.push(current);
      current = { section: field, fields: [] };
    } else {
      current.fields.push({ field, index });
    }
  });
  if (current.section || current.fields.length) groups.push(current);

  const renderField = ({ field, index }: { field: ScreenField; index: number }) => {
    const name = fieldName(field, index);
    if (!isFieldVisible(field, values)) return null;
    const label = String(field.label ?? name);
    const type = String(field.type ?? 'Text');
    const value = values[name] ?? field.defaultValue;
    const inputId = `flow-${interviewId}-${name}`;
    const helpId = `${inputId}-help`;
    const helpText = typeof field.helpText === 'string' ? field.helpText : '';
    const setValue = (nextValue: unknown) => onValueChange(name, nextValue);
    const help = helpText ? <small className="settings-panel-copy" id={helpId}>{helpText}</small> : null;
    const choices = (Array.isArray(field.choices) ? field.choices : []).filter((choice): choice is string => typeof choice === 'string');

    if (type === 'Custom Component') {
      const definition = findRegisteredComponentForInstance(libraryComponents,field,'flow');
      if (!definition) return <div className="flow-screen-component-error" role="alert" key={name}>
        Custom component "{String(field.componentApiName ?? '')}" is no longer registered for Flow screens.
      </div>;
      let componentProps: Record<string, unknown> = {};
      if (typeof field.componentPropsJson === 'string') {
        try {
          const parsed: unknown = JSON.parse(field.componentPropsJson);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return <div className="flow-screen-component-error" role="alert" key={name}>Component props must be a JSON object.</div>;
          }
          componentProps = parsed as Record<string, unknown>;
        } catch {
          return <div className="flow-screen-component-error" role="alert" key={name}>Component props contain invalid JSON.</div>;
        }
      }
      const resize = definition.resize;
      const width = typeof field.width === 'number' ? field.width : resize?.defaultWidth ?? 320;
      const height = typeof field.height === 'number' ? field.height : resize?.defaultHeight ?? 180;
      const safeWidth = Math.min(2000, Math.max(resize?.minWidth ?? 120, width));
      const safeHeight = Math.min(2000, Math.max(resize?.minHeight ?? 60, height));
      return <div className="flow-screen-custom-component" key={name}
        style={{
          gridColumn: field.columnSpan === 2 ? '1 / -1' : undefined,
          width: safeWidth,
          height: safeHeight,
          minWidth: resize?.minWidth ?? 120,
          minHeight: resize?.minHeight ?? 60,
          maxWidth: '100%',
          ...resolveLayoutStyle(componentProps, layoutDevice)
        }}>
        <RegisteredComponent definition={definition} props={{
          ...componentProps,
          properties: componentProps,
          ...componentLayoutProps(componentProps, layoutDevice),
          label,
          value,
          onChange: setValue,
          onAction: (action: unknown) => {
            if (typeof action === 'object' && action !== null && 'value' in action) {
              setValue((action as { value: unknown }).value);
            } else {
              setValue(action);
            }
          }
        }} />
      </div>;
    }
    if (type === 'Display Text') {
      const text = resolveScreenText(field.text, values);
      const definition = findRegisteredComponent(libraryComponents, 'OneText', 'flow');
      // Keep empty legacy display text unchanged: OneText has a non-empty placeholder.
      if (definition && text) return <RegisteredComponent key={name} definition={definition} props={{
        kind: 'Text', text, label, value: text,
        ...componentLayoutProps(field, layoutDevice)
      }} />;
      return <p className="settings-panel-copy" key={`display-${index}`} style={{ whiteSpace: 'pre-wrap' }}>{text}</p>;
    }
    if (type === 'Display Image') {
      const src = resolveScreenText(field.imageUrl, values);
      const alt = String(field.imageAltText ?? '');
      return <figure className="flow-screen-image" key={`image-${index}`}>
        <img src={src} alt={alt} loading="lazy" />
        {label && <figcaption>{label}</figcaption>}
      </figure>;
    }
    if (['Address', 'Name', 'Lookup', 'Choice Lookup', 'Data Table', 'File Upload', 'Repeater'].includes(type)) {
      return <Suspense key={name} fallback={<div className="records-loading" role="status">Loading field…</div>}>
        <FlowScreenAdvancedField libraryComponents={libraryComponents} field={field} label={label} inputId={inputId}
          helpId={helpId} helpText={helpText} value={value} values={values} setValue={setValue}
          loadRecords={loadRecords} onError={onError} />
      </Suspense>;
    }
    if (type === 'Checkbox' || type === 'Toggle') return <div key={name}><label className="checkbox-row" htmlFor={inputId}><input id={inputId} type="checkbox" role={type === 'Toggle' ? 'switch' : undefined} required={field.required === true} aria-required={field.required === true} aria-describedby={helpText ? helpId : undefined} checked={value === true} onChange={(event) => setValue(event.target.checked)} />{label}{field.required === true ? ' *' : ''}</label>{help}</div>;
    if (type === 'Long Text Area') return <label className="form-label" htmlFor={inputId} key={name}>{label}<textarea id={inputId} className="form-control" value={typeof value === 'string' ? value : ''} required={field.required === true} minLength={typeof field.minLength === 'number' ? field.minLength : undefined} maxLength={typeof field.maxLength === 'number' ? field.maxLength : undefined} aria-describedby={helpText ? helpId : undefined} onChange={(event) => setValue(event.target.value)} />{help}</label>;
    if (type === 'Slider') return <label className="form-label" htmlFor={inputId} key={name}>{label}<input id={inputId} className="form-control" type="range" value={typeof value === 'number' ? value : typeof field.min === 'number' ? field.min : 0} min={typeof field.min === 'number' ? field.min : 0} max={typeof field.max === 'number' ? field.max : 100} step={typeof field.step === 'number' ? field.step : 1} aria-valuetext={String(value ?? '')} aria-describedby={helpText ? helpId : undefined} onChange={(event) => setValue(Number(event.target.value))} /><output htmlFor={inputId}>{String(value ?? '')}</output>{help}</label>;
    if (type === 'Multi-Select Picklist' && field.displayAs === 'Checkbox Group') return <fieldset className="form-label" aria-describedby={helpText ? helpId : undefined} key={name}><legend>{label}{field.required === true ? ' *' : ''}</legend>{choices.map((choice) => <label className="checkbox-row" key={choice}><input type="checkbox" checked={Array.isArray(value) && value.includes(choice)} onChange={(event) => setValue(event.target.checked ? [...(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []), choice] : (Array.isArray(value) ? value.filter((item) => item !== choice) : []))} />{choice}</label>)}{help}</fieldset>;
    if (type === 'Multi-Select Picklist') return <label className="form-label" key={name}>{label}<select className="form-control" multiple value={Array.isArray(value) ? value.filter((choice): choice is string => typeof choice === 'string') : []} required={field.required === true} onChange={(event) => setValue(Array.from(event.target.selectedOptions, (option) => option.value))}>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select>{help}</label>;
    if (type === 'Picklist' && field.displayAs === 'Radio Buttons') return <fieldset className="form-label" key={name}><legend>{label}{field.required === true ? ' *' : ''}</legend>{choices.map((choice) => <label className="checkbox-row" key={choice}><input type="radio" name={`flow-${interviewId}-${name}`} required={field.required === true} checked={value === choice} onChange={() => setValue(choice)} />{choice}</label>)}{help}</fieldset>;
    if (type === 'Picklist') return <label className="form-label" htmlFor={inputId} key={name}>{label}<select id={inputId} className="form-control" value={typeof value === 'string' ? value : ''} required={field.required === true} aria-describedby={helpText ? helpId : undefined} onChange={(event) => setValue(event.target.value)}><option value="">Select an option</option>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select>{help}</label>;
    return <label className="form-label" htmlFor={inputId} key={name}>{label}<input id={inputId} className="form-control" type={type === 'Password' ? 'password' : type === 'Number' || type === 'Currency' ? 'number' : type === 'Date' ? 'date' : type === 'Time' ? 'time' : type === 'Date/Time' ? 'datetime-local' : type === 'Email' ? 'email' : type === 'URL' ? 'url' : type === 'Phone' ? 'tel' : 'text'} value={typeof value === 'string' || typeof value === 'number' ? value : ''} required={field.required === true} min={typeof field.min === 'number' ? field.min : undefined} max={typeof field.max === 'number' ? field.max : undefined} step={typeof field.step === 'number' ? field.step : undefined} minLength={typeof field.minLength === 'number' ? field.minLength : undefined} maxLength={typeof field.maxLength === 'number' ? field.maxLength : undefined} pattern={typeof field.pattern === 'string' ? field.pattern : undefined} title={typeof field.validationMessage === 'string' ? field.validationMessage : undefined} aria-describedby={helpText ? helpId : undefined} onChange={(event) => setValue(type === 'Number' || type === 'Currency' ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value)} />{help}</label>;
  };

  return <>{groups.map((group, groupIndex) => group.section
    ? <fieldset className="flow-screen-section" key={`section-${groupIndex}`}>
      <legend>{String(group.section.label ?? 'Section')}</legend>
      {typeof group.section.description === 'string' && group.section.description.trim()
        && <p className="settings-panel-copy">{group.section.description}</p>}
      <div className={`flow-screen-section-grid${group.section.columns === 2 ? ' flow-screen-section-grid-two' : ''}`}>
        {group.fields.map(renderField)}
      </div>
    </fieldset>
    : group.fields.map(renderField))}</>;
}
