/** Pure presentation mapping shared by Records and UNE components.
 * Selected roles are unique; unspecified visible fields fill the remaining slots.
 * Hidden columns never leak into phone rows. Desktop always receives its original columns.
 */
export const PHONE_ROLES = Object.freeze(['title','subtitle','badge','trailing']);
export function resolvePhoneColumns(columns, mapping={}) {
  const source=Array.isArray(columns)?columns.filter(x=>x&&typeof x==='object'):[];
  const key=x=>String(x.apiName??x.key??x.fieldApiName??'');
  const result={title:null,subtitle:null,badge:null,trailing:null};
  const claimed=new Set();
  const roleMapping=mapping&&typeof mapping==='object'&&!Array.isArray(mapping)?mapping:{};
  for(const column of source){
    const id=key(column),role=roleMapping[id]??column.phoneRole;
    if(PHONE_ROLES.includes(role)&&result[role]===null){
      result[role]=column;claimed.add(id);
    }
  }
  const remaining=source.filter(column=>{
    const id=key(column);
    return id&&!claimed.has(id)&&roleMapping[id]!=='hidden'&&column.phoneRole!=='hidden';
  });
  for(const role of PHONE_ROLES) {
    if(result[role]===null && remaining.length>0) {
      const column=remaining.shift();
      result[role]=column;
      claimed.add(key(column));
    }
  }
  return result;
}
