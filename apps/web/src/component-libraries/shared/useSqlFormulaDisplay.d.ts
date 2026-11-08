export function isSelectedSqlFormula(value:unknown):boolean;
export function useSqlFormulaDisplay(properties:Record<string,unknown>,
 hooks:{useMemo:typeof import('react').useMemo;useEffect:typeof import('react').useEffect;
  useState:typeof import('react').useState;useRef:typeof import('react').useRef}
):(source:unknown,record?:Record<string,unknown>)=>
 ({value:unknown;error?:string;loading?:boolean}|undefined);
