import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';
export type PageNavigatorEntry = {
  id:string; type:string; baseName:string; name:string; path:string; depth:number;
  hidden:boolean; locked:boolean; customName:boolean; location:string;
  detail:string; searchText:string; searchable:string;
};
export function navigatorParentId(component:PageComponentMetadata):string|null;
export function navigatorType(type:string, labels?:Record<string,string>):string;
export function buildPageNavigatorEntries(components:PageComponentMetadata[], typeLabels?:Record<string,string>):PageNavigatorEntry[];
export function filterPageNavigatorEntries(entries:PageNavigatorEntry[], query?:string, type?:string):PageNavigatorEntry[];
