import {generateMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import AppManagerList from '../AppManagerList/AppManagerList';
import AppPublishDialog from '../AppPublishDialog/AppPublishDialog';
import { cloneAppConfiguration } from './appCloneConfiguration';
import ChecklistMultiSelect, { type ChecklistChoice } from '../../../component-libraries/shared/primitives/ChecklistMultiSelect/ChecklistMultiSelect';
import './AppManagerLayout.css';
import AppSetupGuide from '../AppSetupGuide/AppSetupGuide';
import { suggestAppApiName, type SetupDestination } from '../AppSetupGuide/appSetupReadiness';
import { moveNavigationEntry, reconcileNavigationOrder } from '../../workspace/Navigation/appNavigation';
import {PlatformPageSlot} from '../../platform/Workspace/PlatformPageSlot';
import {appManagerFieldDefinitions,validateAppManagerField,type AppManagerFieldKey} from './adminAppFieldMetadata';
import AdminPropertyControl from '../../builders/AdminPropertyControl/AdminPropertyControl';
import type { DashboardMetadata, FlowDefinitionMetadata, LibraryComponentMetadata, LightningAppMetadata, LightningPageMetadata, ObjectMetadata, ReportMetadata } from '../../metadata/Definitions/metadata';

type AppDraft = LightningAppMetadata;

const appDraftFromMetadata = (app: AppDraft): AppDraft => ({
  ...app,
  navigationItems: [...(app.navigationItems ?? [])],
  navigationPageApiNames: [...(app.navigationPageApiNames ?? [])],
  navigationOrder: reconcileNavigationOrder(app.navigationItems ?? [], app.navigationPageApiNames ?? [], app.navigationOrder ?? []),
  utilityItems: [...(app.utilityItems ?? [])],
  brandColor: app.brandColor || '#1d4ed8'
});

const emptyApp = (): AppDraft => ({
  apiName: '',
  label: '',
  description: '',
  navigationItems: [],
  navigationPageApiNames: [],
  navigationOrder: [],
  brandColor: '#1d4ed8',
  utilityItems: []
});

export default function AppManager({
  apps,
  objects,
  pages,
  flows = [],
  libraryComponents = [],
  reports = [],
  dashboards = [],
  onOpenWorkspace,
  request,
  onSave,
  onDelete,
  embedded = false,
  onClose,
  onOpenPage,
  initialSelectedApiName = '',
  onSelectedAppChange,
  canPublish = false
}: {
  apps: LightningAppMetadata[];
  objects: ObjectMetadata[];
  pages: LightningPageMetadata[];
  flows?: FlowDefinitionMetadata[];
  libraryComponents?: LibraryComponentMetadata[];
  reports?: ReportMetadata[];
  dashboards?: DashboardMetadata[];
  onOpenWorkspace?: (destination: SetupDestination) => void;
  request?: <T>(path: string, init?: RequestInit) => Promise<T>;
  onSave: (app: LightningAppMetadata, updating: boolean) => Promise<void>;
  onDelete: (apiName: string) => Promise<void>;
  embedded?: boolean;
  onClose?: () => void;
  onOpenPage?: (apiName: string) => void;
  initialSelectedApiName?: string;
  onSelectedAppChange?: (apiName: string) => void;
  /** OneEngine holders may publish tenant-built apps to AppExchange. */
  canPublish?: boolean;
}) {
  const [publishing, setPublishing] = useState('');
  const linkedAppApiName=embedded?'':new URLSearchParams(window.location.search).get('editApp')??'';
  const initialApp=linkedAppApiName==='new'?undefined:apps.find(app=>app.apiName===(initialSelectedApiName||linkedAppApiName))??apps[0];
  const [selectedApiName, setSelectedApiName] = useState(initialApp?.apiName ?? '');
  const [draft, setDraft] = useState<AppDraft>(initialApp ? appDraftFromMetadata(initialApp) : emptyApp());
  const [creating, setCreating] = useState(linkedAppApiName==='new');
  const [view, setView] = useState<'list' | 'form'>(embedded||Boolean(linkedAppApiName)?'form':'list');
  const [activeStep,setActiveStep] = useState('app-basics');
  const updateEditorRoute=(apiName:string|null,push=false)=>{
    if(embedded)return;
    const url=new URL(window.location.href);
    if(apiName)url.searchParams.set('editApp',apiName);else url.searchParams.delete('editApp');
    window.history[push?'pushState':'replaceState'](window.history.state,'',url.pathname+url.search+url.hash);
  };
  useEffect(()=>{
    if(embedded)return;
    const sync=()=>{
      const selected=new URLSearchParams(window.location.search).get('editApp');
      const app=selected?apps.find(item=>item.apiName===selected):null;
      if(app){setSelectedApiName(app.apiName);setDraft(appDraftFromMetadata(app));setCreating(false);setView('form');}
      else if(selected==='new'){setSelectedApiName('');setDraft(emptyApp());setCreating(true);setView('form');}
      else {setCreating(false);setView('list');}
    };
    window.addEventListener('popstate',sync);
    return ()=>window.removeEventListener('popstate',sync);
  },[embedded,apps]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard,setConfirmDiscard]=useState(false);
  const deleteTrigger=useRef<HTMLButtonElement>(null);
  const confirmDialog=useRef<HTMLElement>(null);
  const dismissDialog=()=>{setConfirmDelete(false);setConfirmDiscard(false);requestAnimationFrame(()=>{const focusTarget=deleteTrigger.current??document.querySelector<HTMLButtonElement>('.app-manager-top button');focusTarget?.focus();});};
  const dialogKeyboard=(event:ReactKeyboardEvent<HTMLElement>)=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissDialog();return;}
    if(event.key!=='Tab')return;
    const focusables=Array.from(confirmDialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);
    if(!focusables.length)return;
    if(event.shiftKey&&document.activeElement===focusables[0]){event.preventDefault();focusables[focusables.length-1].focus();}
    else if(!event.shiftKey&&document.activeElement===focusables[focusables.length-1]){event.preventDefault();focusables[0].focus();}
  };
  const assignedPages = pages.filter((page) => page.status === 'Active'
    && (page.activationAssignments ?? []).some((assignment) => assignment.appId === selectedApiName));

  useEffect(() => {
    if (creating) return;
    const selected = apps.find((app) => app.apiName === selectedApiName) ?? apps[0];
    if (selected) {
      setSelectedApiName(selected.apiName);
      setDraft(appDraftFromMetadata(selected));
    } else {
      setSelectedApiName('');
      setDraft(emptyApp());
    }
  }, [apps, creating, selectedApiName]);
  useEffect(() => {
    if (embedded && selectedApiName) onSelectedAppChange?.(selectedApiName);
  }, [embedded, onSelectedAppChange, selectedApiName]);

  const update = <K extends keyof AppDraft>(key: K, value: AppDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError('');
    setNotice('');
  };

  const toggleNavigation = (type: 'Object' | 'App Page', apiName: string, checked: boolean) => {
    setDraft((current) => {
      const key = type === 'Object' ? 'navigationItems' : 'navigationPageApiNames';
      const selected = checked
        ? [...new Set([...current[key], apiName])]
        : current[key].filter((item) => item !== apiName);
      const next: AppDraft = { ...current,
        navigationItems: type === 'Object' ? selected : current.navigationItems,
        navigationPageApiNames: type === 'App Page' ? selected : current.navigationPageApiNames
      };
      next.navigationOrder = reconcileNavigationOrder(next.navigationItems, next.navigationPageApiNames, current.navigationOrder);
      return next;
    });
    setError('');
    setNotice('');
  };
  const moveNavigation = (from: number, to: number) => {
    setDraft((current) => ({
      ...current,
      navigationOrder: moveNavigationEntry(
        reconcileNavigationOrder(current.navigationItems, current.navigationPageApiNames, current.navigationOrder),
        from, to
      )
    }));
    setNotice('');
  };
  const navigationOrder = reconcileNavigationOrder(draft.navigationItems, draft.navigationPageApiNames, draft.navigationOrder);
  const setNavigationSelection = (type: 'Object' | 'App Page', selected: string[]) => {
    setDraft(current => {
      const navigationItems = type === 'Object' ? selected : current.navigationItems;
      const navigationPageApiNames = type === 'App Page' ? selected : current.navigationPageApiNames;
      return {...current, navigationItems, navigationPageApiNames,
        navigationOrder: reconcileNavigationOrder(navigationItems, navigationPageApiNames, current.navigationOrder)};
    });
    setError(''); setNotice('');
  };
  const objectChoices: ChecklistChoice[] = objects.map(object => ({
    value: object.apiName, label: object.pluralLabel,
    meta: object.kind + (objects.some(other => other.apiName !== object.apiName && other.label === object.label)
      ? ' · Same label' : '')
  }));
  const pageChoices: ChecklistChoice[] = pages.filter(page => page.pageType === 'App Page').map(page => ({
    value: page.apiName, label: page.label, meta: page.pageType + ' · ' + page.status,
    disabled: page.status !== 'Active'
  }));
  const displayObjectNames = draft.navigationItems.map(name =>
    objects.find(item => item.apiName === name)?.pluralLabel ?? name);
  const displayPageNames = draft.navigationPageApiNames.map(name =>
    pages.find(item => item.apiName === name)?.label ?? name);


  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const label = draft.label.trim();
      const apiName = creating
        ? (draft.apiName.trim().toLowerCase() || generateMetadataApiName(label))
        : draft.apiName;
      if (creating && apps.some((app) => app.apiName.toLowerCase() === apiName.toLowerCase())) {
        throw new Error('This Developer Name is already in use. Choose another name.');
      }
      for (const field of appManagerFieldDefinitions) {
        const key = field.propertyKey as AppManagerFieldKey;
        const validation = validateAppManagerField(key,key==='apiName'?apiName:key==='label'?label:draft[key]);
        if (validation) throw new Error(validation);
      }
      if (!draft.navigationItems.length && !draft.navigationPageApiNames.length) throw new Error('Select at least one object or active App Page.');
      await onSave({ ...draft, apiName, label, navigationOrder, homePageApiName: homePage }, !creating);
      setCreating(false);
      setSelectedApiName(apiName);
      if (!embedded) {setView('list');updateEditorRoute(null);}
      setNotice('App saved.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save app.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selectedApiName || busy) return;
    setConfirmDelete(false);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await onDelete(selectedApiName);
      const remaining = apps.find((app) => app.apiName !== selectedApiName);
      setCreating(false);
      if (!embedded) {setView('list');updateEditorRoute(null);}
      setSelectedApiName(remaining?.apiName ?? '');
      setDraft(remaining ? appDraftFromMetadata(remaining) : emptyApp());
      setNotice('App deleted.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to delete app.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setCreating(false);
    if (!embedded) {setView('list');updateEditorRoute(null);}
    const previous = apps.find(app => app.apiName === selectedApiName) ?? apps[0];
    setSelectedApiName(previous?.apiName ?? '');
    setDraft(previous ? appDraftFromMetadata(previous) : emptyApp());
    setError(''); setNotice('');setConfirmDelete(false);
  };
  const startNewApp = () => {
    const original = apps.find(app => app.apiName === selectedApiName);
    if (original && JSON.stringify(appDraftFromMetadata(original)) !== JSON.stringify(draft)) {setConfirmDiscard(true);return;}
    setCreating(true); setView('form'); setSelectedApiName(''); setDraft(emptyApp());setActiveStep('app-basics');
    updateEditorRoute('new',true);
    setError(''); setNotice('');
  };
  const editApp = (app: AppDraft) => {
    setCreating(false);
    setSelectedApiName(app.apiName);
    setDraft(appDraftFromMetadata(app));
    setView('form');setActiveStep('app-basics');
    updateEditorRoute(app.apiName,true);
    setError(''); setNotice('');
  };
  const returnToList = () => {
    const original = apps.find(app => app.apiName === selectedApiName);
    const changed = creating
      ? Boolean(draft.label || draft.apiName || draft.description ||
          draft.navigationItems.length || draft.navigationPageApiNames.length)
      : Boolean(original && JSON.stringify(appDraftFromMetadata(original)) !== JSON.stringify(draft));
    if (changed) {setConfirmDiscard(true);return;}
    cancel();
  };
  const cloneApp = (source: AppDraft) => {
    if (busy) return;
    // Cloning is a draft operation: review and save without a blocking browser dialog.
    const copy = cloneAppConfiguration(source, apps);
    setDraft(appDraftFromMetadata(copy));
    setSelectedApiName('');
    setCreating(true);
    setView('form');setActiveStep('app-basics');
    updateEditorRoute('new',true);
    setError('');
    setNotice('Review the copied settings and select Create App to save this clone.');
  };
  useEffect(()=>{
    // The alertdialog owns Escape while either confirmation is visible.
    if(embedded||view!=='form'||busy||confirmDelete||confirmDiscard)return;
    const dismiss=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||document.querySelector('[role="dialog"]'))return;
      event.preventDefault();
      const original=apps.find(app=>app.apiName===selectedApiName);
      const dirty=creating
        ?Boolean(draft.label||draft.apiName||draft.navigationItems.length||draft.navigationPageApiNames.length)
        :Boolean(original&&JSON.stringify(appDraftFromMetadata(original))!==JSON.stringify(draft));
      // Escape leaves a clean editor immediately and gives dirty drafts an actionable choice.
      if(dirty)setConfirmDiscard(true);
      else cancel();
    };
    document.addEventListener('keydown',dismiss);
    return ()=>document.removeEventListener('keydown',dismiss);
  },[embedded,view,busy,confirmDelete,confirmDiscard,creating,draft,selectedApiName,apps]);
  const openSetupWorkspace = (destination: SetupDestination) => {
    const original = apps.find(app => app.apiName === selectedApiName);
    const unsaved = creating || (original && JSON.stringify(appDraftFromMetadata(original)) !== JSON.stringify(draft));
    if (unsaved) {setError('Save or Cancel your changes before leaving App Manager.');return;}
    onOpenWorkspace?.(destination);
  };
  const steps = [
    {id:'app-basics',name:'Basics'},
    {id:'app-navigation',name:'Navigation'},
    {id:'app-home',name:'Home Page'},
    {id:'app-review',name:'Review & Save'}
  ];
  const stepIndex=Math.max(0,steps.findIndex(step=>step.id===activeStep));
  // The Home Page choices are the app's own App Pages, in navigation order.
  const homeChoices=navigationOrder.filter(item=>item.type==='App Page').map(item=>item.apiName);
  const lock=draft.lockScreen??{enabled:false,idleMinutes:5};
  const homePage=homeChoices.includes(draft.homePageApiName??'')?draft.homePageApiName??'':homeChoices[0]??'';
  const homeLabel=pages.find(page=>page.apiName===homePage)?.label??homePage;
  const stepError=(index:number)=>{
    if(index>=1&&!draft.label.trim())return 'Enter an App Label.';
    if(index>=2&&!draft.navigationItems.length&&!draft.navigationPageApiNames.length)
      return 'Select at least one object or active App Page.';
    return '';
  };
  const goToStep=(index:number)=>{
    const problem=index>stepIndex?stepError(index):'';
    if(problem){setError(problem);return;}
    setError('');setActiveStep(steps[index].id);
  };

  return <div className="home-content app-manager-workspace">
    {(confirmDelete||confirmDiscard) && <div className="app-manager-confirm-overlay" role="presentation">
      <section ref={confirmDialog} className="app-manager-confirm-dialog" role="alertdialog" aria-modal="true"
        aria-labelledby="app-manager-confirm-title" aria-describedby="app-manager-confirm-description"
        onKeyDown={dialogKeyboard}>
        <h2 id="app-manager-confirm-title">{confirmDiscard?'Discard unsaved changes?':`Delete ${draft.label}?`}</h2>
        <p id="app-manager-confirm-description">{confirmDiscard?'Your edits have not been saved. Discarding will return to the app list without changing the stored app.':'This will delete the selected app configuration. This action cannot be undone.'}</p>
        <div className="app-manager-confirm-actions">
          <button className="btn" type="button" autoFocus onClick={dismissDialog}>Keep editing</button>
          {confirmDiscard
            ?<button className="btn btn-danger" type="button" onClick={()=>{setConfirmDiscard(false);cancel();}}>Discard changes</button>
            :<button className="btn btn-danger" type="button" onClick={()=>void remove()} disabled={busy}>Delete App</button>}
        </div>
      </section>
    </div>}
    <header className="page-heading app-manager-top">
      <div>
        <div className="eyebrow">{embedded ? 'App Builder' : 'Platform Tools'}</div>
        <h1>{embedded ? 'App Settings' : 'App Manager'}</h1>
        <p>Create and configure applications using the existing Objects, Pages and navigation.</p>
      </div>
      {embedded
        ? <button className="btn" type="button" onClick={onClose}>Back to Page Builder</button>
        : view === 'list'
          ? <button className="btn btn-brand" type="button" onClick={startNewApp} disabled={busy}><Plus size={14}/>New App</button>
          : <button className="btn" type="button" onClick={returnToList} disabled={busy}><ArrowLeft size={14}/> All Apps</button>}
    </header>

    {!embedded && view === 'list' ? <>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
      <AppManagerList apps={apps} busy={busy} onEdit={editApp} onClone={cloneApp}
        onPublish={canPublish && request ? (app) => setPublishing(app.apiName) : undefined}/>
      {publishing && request && <AppPublishDialog appApiName={publishing} request={request} onClose={() => setPublishing('')}/>}
    </> : <>
    <ol className="app-manager-stepper" aria-label="Application setup steps">
      {steps.map((step,index)=><li key={step.id} className="app-manager-step-item">
        <button type="button" className={'app-manager-step'+(index<stepIndex?' is-done':'')}
          aria-current={activeStep===step.id?'step':undefined}
          aria-label={'Step '+(index+1)+' of '+steps.length+': '+step.name}
          onClick={()=>goToStep(index)}>
          <span className="app-manager-step-number">{index+1}</span>
          <strong>{step.name}</strong>
        </button>
      </li>)}
    </ol>

    <section className="surface permission-section app-manager app-manager-form-card" aria-label="App configuration">
      {!creating && embedded && <label className="form-label app-manager-switcher">App
        <select className="form-control" aria-label="Select app to edit" value={selectedApiName}
          onChange={event => {
            const original = apps.find(app => app.apiName === selectedApiName);
            if (original && JSON.stringify(appDraftFromMetadata(original)) !== JSON.stringify(draft)) {setConfirmDiscard(true);return;}
            setSelectedApiName(event.target.value); setError(''); setNotice('');
          }}>
          {apps.map(app => <option key={app.apiName} value={app.apiName}>{app.label}</option>)}
        </select>
      </label>}
      <form onSubmit={event => {
        if(stepIndex<steps.length-1){event.preventDefault();goToStep(stepIndex+1);return;}
        void save(event);
      }}>
        {activeStep==='app-basics' && <div id="app-basics" className="app-manager-form-section">
          <PlatformPageSlot slotKey="identity">
            <div className="app-manager-identity-grid">
              {appManagerFieldDefinitions.map(definition => {
                const field = definition.propertyKey as AppManagerFieldKey;
                const disabled = field === 'apiName' && !creating;
                const change = (next: string) => {
                  if (field === 'label') {
                    setDraft(current => ({
                      ...current, label: next,
                      apiName: creating && (!current.apiName || current.apiName === suggestAppApiName(current.label, apps))
                        ? suggestAppApiName(next, apps) : current.apiName
                    }));
                    setError(''); setNotice('');
                  } else update(field,field==='apiName'&&creating?next.toLowerCase():next);
                };
                return <div className={'app-manager-identity-' + field} key={field}>
                  <AdminPropertyControl definition={definition} value={draft[field]}
                    disabled={disabled} onChange={change}/>
                </div>;
              })}
            </div>
          </PlatformPageSlot>
        </div>}

        {activeStep==='app-navigation' && <div id="app-navigation" className="app-manager-form-section">
          <div className="app-manager-selectors">
            <PlatformPageSlot slotKey="pages">
              <ChecklistMultiSelect label="App Pages (tabs)" choices={pageChoices}
                values={draft.navigationPageApiNames} onChange={values => setNavigationSelection('App Page',values)}
                placeholder="Select App Pages…" searchPlaceholder="Search Pages…"
                emptyText="No Pages found. Publish an App Page using Page Builder."/>
            </PlatformPageSlot>
            <PlatformPageSlot slotKey="navigation-items">
              <ChecklistMultiSelect label="Objects (records)" choices={objectChoices}
                values={draft.navigationItems} onChange={values => setNavigationSelection('Object',values)}
                placeholder="Select objects…" searchPlaceholder="Search Objects…"/>
            </PlatformPageSlot>
          </div>
          <PlatformPageSlot slotKey="navigation-order"><fieldset className="app-manager-fieldset">
            <legend>Order</legend>
            <ol className="app-manager-navigation-order">
              {navigationOrder.map((item,index) => {
                const label = item.type === 'Object'
                  ? objects.find(object => object.apiName === item.apiName)?.pluralLabel ?? item.apiName
                  : pages.find(page => page.apiName === item.apiName)?.label ?? item.apiName;
                return <li key={item.type + ':' + item.apiName}>
                  <span className="app-manager-navigation-label"><strong>{label}</strong><small>{item.type}</small></span>
                  <div className="app-manager-order-controls">
                    <button type="button" className="btn btn-small" aria-label={'Move ' + label + ' up'}
                      disabled={index === 0 || busy} onClick={() => moveNavigation(index,index - 1)}><ArrowUp size={14}/></button>
                    <button type="button" className="btn btn-small" aria-label={'Move ' + label + ' down'}
                      disabled={index === navigationOrder.length - 1 || busy} onClick={() => moveNavigation(index,index + 1)}><ArrowDown size={14}/></button>
                    <button type="button" className="btn btn-small" disabled={busy}
                      aria-label={'Remove ' + label + ' from navigation'} onClick={() => toggleNavigation(item.type,item.apiName,false)}><Trash2 size={14}/></button>
                  </div>
                </li>;
              })}
            </ol>
            {!navigationOrder.length && <span className="permission-help">Select at least one App Page or object.</span>}
          </fieldset></PlatformPageSlot>
        </div>}

        {activeStep==='app-home' && <div id="app-home" className="app-manager-form-section">
          <label className="form-label" htmlFor="app-home-page">Home Page
            <select id="app-home-page" className="form-control" value={homePage} disabled={!homeChoices.length}
              onChange={event=>update('homePageApiName',event.target.value)}>
              {homeChoices.map(name=><option key={name} value={name}>{pages.find(page=>page.apiName===name)?.label??name}</option>)}
            </select>
          </label>
          <p className="permission-help">{homeChoices.length
            ?'Users land on this page when they open the app. It defaults to the first App Page.'
            :'Add an App Page in Navigation to choose a Home Page.'}</p>
          {assignedPages.some(page=>page.pageType==='Home Page') && <p className="permission-help">
            A Home Page assigned in Page Builder ({assignedPages.filter(page=>page.pageType==='Home Page').map(page=>page.label).join(', ')}) still takes priority.</p>}
          <fieldset className="app-manager-lock">
            <legend>Lock screen</legend>
            <label className="form-label"><input type="checkbox" checked={lock.enabled}
              onChange={event=>update('lockScreen',{...lock,enabled:event.target.checked})}/> Lock this app's pages (PIN sign-in for saved users)</label>
            <label className="form-label" htmlFor="app-lock-idle">Lock after idle (minutes, 0 = only on LOCKSCREEN() or the Lock button)
              <input id="app-lock-idle" className="form-control" type="number" min={0} max={240} step={1}
                disabled={!lock.enabled} value={lock.idleMinutes}
                onChange={event=>update('lockScreen',{...lock,idleMinutes:Math.min(240,Math.max(0,Math.round(Number(event.target.value)||0)))})}/>
            </label>
            <p className="permission-help">Only this app's pages lock. Page Builder, Setup and other apps never lock.</p>
          </fieldset>
        </div>}

        {activeStep==='app-review' && <div id="app-review" className="app-manager-form-section">
          <dl className="app-manager-review">
            <div><dt>App</dt><dd>{draft.label||'—'} <small>{draft.apiName}</small></dd></div>
            <div><dt>App Pages</dt><dd>{displayPageNames.join(', ')||'None'}</dd></div>
            <div><dt>Objects</dt><dd>{displayObjectNames.join(', ')||'None'}</dd></div>
            <div><dt>Home Page</dt><dd>{homeLabel||'None'}</dd></div>
          </dl>
          <PlatformPageSlot slotKey="utility"><fieldset className="app-manager-fieldset">
            <legend>Utility Bar</legend>
            <div className="app-manager-checks">
              {(['Notes','History'] as const).map(item => <label key={item} htmlFor={'app-utility-'+item.toLowerCase()}>
                <input id={'app-utility-'+item.toLowerCase()} name="app-utility-items" type="checkbox" checked={draft.utilityItems.includes(item)}
                  onChange={event => update('utilityItems',event.target.checked
                    ? [...draft.utilityItems,item]
                    : draft.utilityItems.filter(utility => utility !== item))}/>{item}
              </label>)}
            </div>
          </fieldset></PlatformPageSlot>
          <details className="app-manager-readiness">
            <summary>Setup checks</summary>
            <AppSetupGuide app={draft} apps={apps} objects={objects} pages={pages}
              flows={flows} libraryComponents={libraryComponents} reports={reports} dashboards={dashboards}
              creating={creating} request={request} onOpenWorkspace={openSetupWorkspace}/>
          </details>
        </div>}

        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-success" role="status">{notice}</p>}
        <PlatformPageSlot slotKey="actions"><div className="app-manager-actions">
          {!creating && <button className="btn app-manager-delete" type="button" disabled={busy || apps.length <= 1}
            ref={deleteTrigger} onClick={() => setConfirmDelete(true)}><Trash2 size={14}/>Delete</button>}
          {!embedded && <button className="btn" type="button" disabled={busy} onClick={returnToList}>Cancel</button>}
          {stepIndex>0 && <button className="btn" type="button" disabled={busy} onClick={()=>goToStep(stepIndex-1)}>Back</button>}
          {stepIndex<steps.length-1
            ? <button className="btn btn-brand" type="submit" disabled={busy}>Next</button>
            : <button className="btn btn-brand" type="submit"
                disabled={busy || (!draft.navigationItems.length && !draft.navigationPageApiNames.length)}>
                {busy ? 'Saving…' : creating ? 'Create App' : 'Save Changes'}
                {!busy && <Save size={14}/>}
              </button>}
        </div></PlatformPageSlot>
      </form>
    </section>
    </>}
  </div>;
}
