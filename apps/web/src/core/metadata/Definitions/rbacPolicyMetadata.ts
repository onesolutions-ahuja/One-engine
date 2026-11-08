export type PermissionRuleMetadata={resource:string;action:string;effect:'allow'|'deny'};
export type PermissionPolicyExtras={
 deniedPermissions?:string[];
 advancedRules?:PermissionRuleMetadata[];
};
export type ProfilePolicyExtras=PermissionPolicyExtras&{
 inheritedPermissionSetIds?:string[];
};
