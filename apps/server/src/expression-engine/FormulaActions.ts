/** Action-only names and parameter metadata. Evaluation remains in ActionFormulas. */
export const ACTION_FORMULA_DECLARATIONS=[
 {name:'ACTIONS',parameters:['Action1','Action2']},
 {name:'SCREEN',parameters:['PageApiName','Mode']},
 {name:'FLOW',parameters:['FlowApiName']},
 {name:'CREATERECORD',parameters:['Object','Field1','Value1','AS(variable)']},
 {name:'UPDATERECORD',parameters:['Object','RecordId','Field1','Value1','AS(variable)']},
 {name:'DELETERECORD',parameters:['Object','RecordId']},
 {name:'EMAIL',parameters:['NamedCredential','To','Subject','Body','Attachment1']},
 {name:'WHATSAPP',parameters:['NamedCredential','Recipient','Message','Attachment1']},
 {name:'SMS',parameters:['NamedCredential','To','Message']},
 {name:'PRINT',parameters:['TemplateApiName','RecordId']},
 {name:'CREATEPDF',parameters:['TemplateApiName','RecordId','AS(variable)']},
 {name:'WAIT',parameters:['Minutes','Seconds']},
 {name:'GETRECORD',parameters:['Object','Field1','Value1','AS(variable)']},
 {name:'STATE',parameters:['Key','Value']},
 {name:'FOREACH',parameters:['Object','Field1','Value1','AS(item)','Action']},
 {name:'CLOSESCREEN',parameters:[]},
 {name:'AS',parameters:['variable']}
] as const;
export const ACTION_FORMULA_FUNCTIONS:ReadonlySet<string>=
 new Set(ACTION_FORMULA_DECLARATIONS.map(item=>item.name));
