/** Flow-backed automation recipes. Drafts reuse the shared Flow runtime without app-specific services. */
export type AutomationKind='Assignment'|'Escalation';
export type RecipeInput={
 kind:AutomationKind;objectApi:string;apiName:string;label:string;
 trigger:'created'|'updated'|'created-or-updated';
 conditions:Array<{field:string;operator:string;value:string}>;
 assigneeId?:string;dueField?:string;offsetAmount?:number;offsetUnit?:string;
 taskSubject?:string;
};
const identifier=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
export function buildAutomationFlow(input:RecipeInput){
 if(!identifier.test(input.objectApi)||!identifier.test(input.apiName)||!input.label.trim()
  ||input.label.length>160||input.conditions.length>20
  ||input.conditions.some(c=>!identifier.test(c.field)||!c.operator||c.value.length>512))
  throw Error('Invalid automation recipe');
 if(input.kind==='Assignment'&&input.trigger!=='created')
  throw Error('Owner assignment recipes must run on record creation to prevent recursive reassignment');
 const trigger=input.kind==='Escalation'?'created-or-updated':input.trigger;
 const startConfig={object:input.objectApi,trigger,runWhen:'after-save',
   entryConditions:input.conditions,conditionLogic:'All',triggerOrder:100};
 const steps:Array<{id:number;type:string;label:string;config:Record<string,unknown>}>=[
   {id:1,type:'Start',label:'Record trigger',config:startConfig}
 ];
 const connectors:Array<{id:string;from:number;to:number;label:string;kind:'normal'|'scheduled';scheduledPath?:Record<string,unknown>}>=[];
 if(input.kind==='Assignment'){
   if(!input.assigneeId||!/^[0-9a-f-]{36}$/i.test(input.assigneeId))
    throw Error('Choose a valid tenant user or queue ID');
   steps.push({id:2,type:'Update Records',label:'Assign record owner',
     config:{object:input.objectApi,recordId:'{!$Record.Id}',
       fieldValues:[{field:'OwnerId',value:input.assigneeId}]}});
   connectors.push({id:'assignment-start',from:1,to:2,label:'',kind:'normal'});
 }else{
   if(!input.dueField||!identifier.test(input.dueField)
     ||!Number.isInteger(input.offsetAmount)||Math.abs(input.offsetAmount!)>3650
     ||!['Minutes','Hours','Days'].includes(input.offsetUnit??'')
     ||!input.taskSubject?.trim())throw Error('Complete escalation date field, offset and task');
   steps.push({id:2,type:'Action',label:'Escalation task',
     config:{actionType:'Create Task',objectApiName:input.objectApi,
       recordId:'{!$Record.Id}',subject:input.taskSubject}});
   steps.push({id:4,type:'End',label:'Immediate path complete',config:{}});
   connectors.push({id:'escalation-immediate',from:1,to:4,label:'Default',kind:'normal'});
   connectors.push({id:'escalation-scheduled',from:1,to:2,label:'Escalate',
     kind:'scheduled',scheduledPath:{timeSourceFieldApiName:input.dueField,
       offsetAmount:input.offsetAmount,offsetUnit:input.offsetUnit}});
 }
 steps.push({id:3,type:'End',label:'End',config:{}});
 connectors.push({id:'action-end',from:2,to:3,label:'',kind:'normal'});
 return {apiName:input.apiName,label:input.label,flowType:'Record-Triggered Flow',
   status:'Draft',versionNumber:1,activeVersion:null,triggerObject:input.objectApi,
   startConfig,elements:steps,connectors,resources:[],versions:[]};
}
