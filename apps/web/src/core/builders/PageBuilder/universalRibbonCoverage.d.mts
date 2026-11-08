/** Types for the pure ESM inventory coverage contract. */
export type RibbonManifest={apiName:string;propertyDefinitions?:readonly {propertyKey:string}[]};
export type RibbonCoverage={
  componentCount:number;
  declaredPropertyCount:number;
  displayedPropertyCount:number;
  missing:string[];
  duplicates:string[];
  unexpected:string[];
  explicitlyExcluded:string[];
};
export function auditUniversalRibbonCoverage(
  manifests:readonly RibbonManifest[],
  visibleKeys:Iterable<string>,
  excludedKeys?:Iterable<string>
):RibbonCoverage;
