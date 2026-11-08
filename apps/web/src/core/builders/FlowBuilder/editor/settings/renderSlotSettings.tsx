import { displayValue } from '../../flowEditorData';
import FlowReferenceInput from '../../../FlowReferenceInput/FlowReferenceInput';

import type { useFlowEditorState } from '../useFlowEditorState';
import type { FlowBuilderProps } from '../FlowBuilderTypes';
import type { useFlowConfiguration } from './useFlowConfiguration';

export function renderSlotSettings(
  editorState: ReturnType<typeof useFlowEditorState>,
  props: FlowBuilderProps,
  configuration: ReturnType<typeof useFlowConfiguration>,
) {
  const { selected } = editorState;
  const { flow, objects } = props;
  const { setConfig } = configuration;

      const mode=displayValue(selected.config.mode) || 'list';
      const textVars=flow.resources.filter(resource=>resource.type==='Variable'
        && resource.dataType==='Text');
      const booleanVars=flow.resources.filter(resource=>resource.type==='Variable'
        && resource.dataType==='Boolean');
      const output=(label:string,key:string,options:typeof textVars)=>{
        return <label className="form-label">{label}<select className="form-control"
          value={displayValue(selected.config[key])} onChange={event=>setConfig(key,event.target.value)}>
          <option value="">Select output</option>{options.map(resource=>
            <option key={resource.name} value={resource.name}>{resource.label || resource.name}</option>)}
        </select></label>;
      };
      return <>
        <p className="settings-panel-copy">Offer only available time slots from the configured staff schedule. Availability and overlapping appointments are checked again when the booking is saved.</p>
        <label className="form-label">Mode<select className="form-control" value={mode}
          onChange={event=>setConfig('mode',event.target.value)}>
          <option value="list">List available times</option>
          <option value="validate">Validate selected time</option>
        </select></label>
        <label className="form-label">Date / Flow Reference
          <FlowReferenceInput ariaLabel="Booking date" value={displayValue(selected.config.date)}
            flow={flow} elementId={selected.id} objects={objects}
            onChange={value=>setConfig('date',value)}/>
        </label>
        <label className="form-label">Assigned Staff ID / Flow Reference
          <FlowReferenceInput ariaLabel="Available slots staff" value={displayValue(selected.config.staffId)}
            flow={flow} elementId={selected.id} objects={objects}
            onChange={value=>setConfig('staffId',value)}/>
        </label>
        {[
          ['startField','Appointment Start Field'],
          ['endField','Appointment End Field'],
          ['staffField','Assigned Staff Field'],
          ['statusField','Appointment Status Field']
        ].map(([key,label])=><label className="form-label" key={key}>{label}
          <input className="form-control" value={displayValue(selected.config[key])}
            onChange={event=>setConfig(key,event.target.value)}/>
        </label>)}
        <label className="form-label">Booking Status Value
          <input className="form-control" value={displayValue(selected.config.bookingStatus)||'Scheduled'}
            onChange={event=>setConfig('bookingStatus',event.target.value)}/>
        </label>
        <label className="form-label">Appointment Duration (minutes)
          <input className="form-control" type="number" min="5" max="240" step="5"
            value={Number(selected.config.durationMinutes ?? 30)}
            onChange={event=>setConfig('durationMinutes',Number(event.target.value))}/>
        </label>
        <label className="form-label">Appointment Object
          <select className="form-control" value={displayValue(selected.config.appointmentObject)}
            onChange={event=>setConfig('appointmentObject',event.target.value)}>
            <option value="">Select object</option>{objects.map(item=>
              <option key={item.apiName} value={item.apiName}>{item.label}</option>)}
          </select>
        </label>
        <label className="form-label">Staff Schedule Object
          <select className="form-control" value={displayValue(selected.config.scheduleObject)}
            onChange={event=>setConfig('scheduleObject',event.target.value)}>
            <option value="">Select object</option>{objects.map(item=>
              <option key={item.apiName} value={item.apiName}>{item.label}</option>)}
          </select>
        </label>
        {mode==='list' ? <>
          <label className="form-label">Maximum Times
            <input className="form-control" type="number" min="1" max="30"
              value={Number(selected.config.maximumSlots ?? 12)}
              onChange={event=>setConfig('maximumSlots',Number(event.target.value))}/>
          </label>
          {output('Available Times Text','outputVariable',textVars)}
          {output('Offered Times Key','allowedVariable',textVars)}
          {output('Has Availability?','availableVariable',booleanVars)}
        </> : <>
          <label className="form-label">Chosen Time / Reference
            <FlowReferenceInput ariaLabel="Chosen time" value={displayValue(selected.config.selectedTime)}
              flow={flow} elementId={selected.id} objects={objects}
              onChange={value=>setConfig('selectedTime',value)}/>
          </label>
          <label className="form-label">Previously Offered Times / Reference
            <FlowReferenceInput ariaLabel="Offered times" value={displayValue(selected.config.allowedSlots)}
              flow={flow} elementId={selected.id} objects={objects}
              onChange={value=>setConfig('allowedSlots',value)}/>
          </label>
          {output('Start Date and Time','startVariable',textVars)}
          {output('End Date and Time','endVariable',textVars)}
          {output('Selected Time Is Valid?','validVariable',booleanVars)}
        </>}
      </>;

}
