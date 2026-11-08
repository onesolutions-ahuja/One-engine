export type RecordChoice={value:string;label:string;price?:number};
export function projectRecordChoices(
  records:unknown,
  labelField:string,
  valueField:string,
  priceField?:string
):RecordChoice[];
export function toggleChoiceSelection(
  current:readonly unknown[],
  next:unknown,
  maxSelections:unknown
):{values:string[];limited:boolean};
