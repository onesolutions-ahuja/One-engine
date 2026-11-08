export type PhoneRole = 'title' | 'subtitle' | 'badge' | 'trailing';
export interface PhoneColumnLike {
  apiName?: string;
  key?: string;
  fieldApiName?: string;
  phoneRole?: PhoneRole | 'hidden' | string;
}
export const PHONE_ROLES: ReadonlyArray<PhoneRole>;
export function resolvePhoneColumns<T extends PhoneColumnLike>(
  columns: readonly T[] | null | undefined,
  mapping?: Record<string,PhoneRole|'hidden'|string>
): {title:T|null;subtitle:T|null;badge:T|null;trailing:T|null};
