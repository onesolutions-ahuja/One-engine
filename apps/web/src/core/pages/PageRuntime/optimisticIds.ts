/** Provisional Ids of predicted creates are valid UUIDs in a reserved range; the
 * real save replaces them (record sets drop this range when the save answers). */
const provisionalRange='ffffffff-ffff-4fff-8fff-';
export const optimisticIdPrefix=(batch:string)=>provisionalRange+batch;
export const isOptimisticId=(id:unknown)=>typeof id==='string'&&id.startsWith(provisionalRange);
