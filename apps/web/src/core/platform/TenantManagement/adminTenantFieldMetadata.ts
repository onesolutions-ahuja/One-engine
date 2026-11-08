/** Existing platform tenant creation API remains the only provisioning authority.
 * Presentation definitions never contain credential values or grant security permissions.
 */
export const tenantCreateFieldDefinitions=[
 {key:'tenantId',label:'Tenant ID',inputType:'text',required:true,minLength:2,maxLength:63,pattern:'[a-z0-9]+(-[a-z0-9]+)*',autoComplete:'off'},
 {key:'tenantName',label:'Organisation name',inputType:'text',required:true,maxLength:120},
 {key:'adminName',label:'Initial administrator name',inputType:'text',required:true,maxLength:120},
 {key:'email',label:'Initial administrator email',inputType:'email',required:true,maxLength:254,autoComplete:'off'},
 {key:'password',label:'Initial administrator password',inputType:'password',required:true,minLength:12,maxLength:256,autoComplete:'new-password'},
 {key:'tenantDeveloperEmail',label:'Tenant developer email',inputType:'email',required:true,maxLength:254,autoComplete:'off'},
 {key:'developerDomain',label:'Developer login domain',inputType:'text',required:true,maxLength:253,placeholder:'tenant-domain.com'}
] as const;
export type TenantCreateFieldKey=typeof tenantCreateFieldDefinitions[number]['key'];
