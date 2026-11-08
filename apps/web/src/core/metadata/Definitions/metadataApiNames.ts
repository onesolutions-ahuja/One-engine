/** Shared editor-side API identifiers. SQL services remain the final authority for uniqueness. */
export const generateMetadataApiName=(label:string,maxLength=80):string=>{
  const ascii=label.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  const base=ascii.replace(/[^A-Za-z0-9_]+/g,'_').replace(/_+/g,'_')
    .replace(/^_+|_+$/g,'').replace(/^[^A-Za-z]+/,'');
  return base.slice(0,maxLength).replace(/_+$/g,'').toLowerCase();
};
export const apiNameIsValid=(name:string):boolean=>/^[A-Za-z][A-Za-z0-9_]*$/.test(name);
export const metadataNameConflict=(name:string,existing:readonly string[]):boolean=>
  existing.some(value=>value.toLowerCase()===name.toLowerCase());
export const suggestMetadataApiName=(base:string,existing:readonly string[],maxLength=80):string=>{
  const normalized=base.toLowerCase();
  if(!apiNameIsValid(normalized))return '';
  if(!metadataNameConflict(normalized,existing))return normalized;
  for(let index=2;index<10000;index++){
    const suffix='_'+index;
    const proposal=normalized.slice(0,maxLength-suffix.length).replace(/_+$/g,'')+suffix;
    if(!metadataNameConflict(proposal,existing))return proposal;
  }
  return '';
};

/** Reserve a platform metadata suffix while suggesting a case-insensitive unique name. */
export const suggestMetadataApiNameWithSuffix=(
  label:string,existing:readonly string[],suffix:string,maxLength=80
):string=>{
  if(!suffix||!/^[A-Za-z0-9_]+$/.test(suffix)||maxLength<=suffix.length)return '';
  const base=generateMetadataApiName(label,maxLength-suffix.length);
  if(!base)return '';
  const reserved=existing.filter(name=>name.toLowerCase().endsWith(suffix.toLowerCase()))
    .map(name=>name.slice(0,-suffix.length));
  const available=suggestMetadataApiName(base,reserved,maxLength-suffix.length);
  return available?available+suffix.toLowerCase():'';
};
