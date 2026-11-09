export type LocalRecordSetFilter={field:string;operator:'eq';value:string};
export type LocalRecordSetProvider={
  rowsFor(object:string,filters:LocalRecordSetFilter[]):Promise<Record<string,unknown>[]|null>;
  rowById?(object:string,id:string):Record<string,unknown>|null;
};
export function setLocalRecordSetProvider(next:LocalRecordSetProvider|null):void;
export function getLocalRecordSetProvider():LocalRecordSetProvider|null;
