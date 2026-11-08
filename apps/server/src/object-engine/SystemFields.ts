/** Shared reserved names: callers still rely on SQL and OneEngine checks. */
export const systemRecordFields=Object.freeze(['Id','CreatedDate','LastModifiedDate','OwnerId','RecordTypeId','IsDeleted'] as const);
export function isSystemRecordField(name:string):boolean{return (systemRecordFields as readonly string[]).includes(name);}
