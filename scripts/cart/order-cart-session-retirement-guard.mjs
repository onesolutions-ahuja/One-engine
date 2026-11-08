/**
 * Defer only the legacy Order.CartSession lookup, which has not yet been
 * migrated to Order.Cart. Never treat missing Cart copies, live Flow/page
 * references or any other active relationship as permission to retire.
 */
export const ORDER_LOOKUP_BLOCKER =
 'other active CartSession relationship fields: Order.CartSession';

export function canDeferOrderCartSessionRetirement(reports){
 if(!Array.isArray(reports)||!reports.some(r=>r?.ready===false))return false;
 return reports.every(r=>Array.isArray(r?.checks)&&
  (r.ready===true&&r.checks.length===0 ||
   r.ready===false&&r.checks.length===1&&r.checks[0]===ORDER_LOOKUP_BLOCKER));
}
