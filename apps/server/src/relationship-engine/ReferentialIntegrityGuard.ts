export type IncomingReference={relationship_type:string;delete_behavior:string|null;required:boolean};
/** Explicitly configured cascades are allowed; unknown or restrictive lookups deny deletion. */
export function assertDeletionAllowed(references:readonly IncomingReference[]):void{
 if(references.some(reference=>reference.relationship_type==='Lookup'&&(
   reference.delete_behavior==='Restrict'
   ||(reference.required&&reference.delete_behavior!=='Cascade')
   ||(reference.delete_behavior!==null
      &&!['Restrict','Clear','Cascade'].includes(reference.delete_behavior))
 )))
  throw new Error('Record delete restricted by a lookup relationship');
}
export function shouldCascadeReference(reference:IncomingReference):boolean{
 return reference.relationship_type==='Master-Detail'
  ||(reference.relationship_type==='Lookup'&&reference.delete_behavior==='Cascade');
}
