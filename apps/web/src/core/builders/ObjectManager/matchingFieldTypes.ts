/** Keep typed Object Manager field choices consistent with shared SQL field types. */
export function supportsMatchingInput(type:string):boolean{
 return /^(?:Text(?:\([1-9][0-9]*\))?|Email|Phone|URL|Picklist)$/i.test(type.trim());
}
