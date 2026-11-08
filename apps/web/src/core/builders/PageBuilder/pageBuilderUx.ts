import type { PageBuilderPaletteCategory } from './pageBuilderPalette';

/** Human-facing words are presentation only: registry IDs and persisted metadata never change. */
export const pageBuilderCategoryLabels: Record<PageBuilderPaletteCategory, string> = {
  'All Components': 'All blocks',
  Favourites: 'Favourites',
  Recent: 'Recently used',
  Layout: 'Sections',
  Display: 'Text & media',
  Inputs: 'Forms & inputs',
  Data: 'Lists & data',
  Navigation: 'Buttons & links'
};

export const pageBuilderStartOptions = [
  { type: 'Home Page', title: 'Home page', description: 'A starting place for your team.' },
  { type: 'Record Page', title: 'Record page', description: 'Display and edit a saved record.' },
  { type: 'App Page', title: 'App page', description: 'Create a page inside an application.' },
  { type: 'Print Template', title: 'Print template', description: 'Design a printable page with record bindings.' },
  { type: 'In-Screen Page', title: 'In-screen window', description: 'Reusable Flow window; not a navigation page.' }
] as const;

/** Recently used entries are local editor preferences, not published tenant page metadata. */
export function addRecentPageBlock(previous: readonly string[], componentType: string, limit = 8): string[] {
  return [componentType, ...previous.filter(id => id !== componentType)].slice(0, limit);
}

export function loadRecentPageBlocks(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string =>
      typeof id === 'string' && id.length > 0 && id.length <= 250))].slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** Short, human-facing summary for builder filters; runtime remains the SQL-backed filter engine. */
export function describeBuilderFilters(
  rules: unknown,
  fields: readonly {apiName:string;label:string;dataType?:string}[],
  limit=2
):string {
  if(!Array.isArray(rules)||rules.length===0)return 'Add record filters';
  const operatorLabels:Record<string,string>={
    Equals:'is',NotEquals:'is not',Contains:'contains',StartsWith:'starts with',
    GreaterThan:'is greater than',LessThan:'is less than',
    GreaterThanOrEqual:'is at least',LessThanOrEqual:'is at most',
    IsBlank:'is blank',IsNotBlank:'is not blank'
  };
  const descriptions=rules.filter(item=>item&&typeof item==='object'&&!Array.isArray(item))
    .slice(0,Math.max(1,limit)).map(raw=>{
      const rule=raw as Record<string,unknown>;
      const field=fields.find(candidate=>candidate.apiName===rule.field);
      const name=field?.label??(rule.field?'A missing field':'Choose a field');
      const operator=String(rule.operator??'Equals');
      const value=rule.value;
      const label=value&&typeof value==='object'&&!Array.isArray(value)
        ? ({PageState:'a page value',CurrentRecord:'the current record',Session:'the current session'} as Record<string,string>)[String((value as Record<string,unknown>).source)]
          ?? 'a connected value'
        : field?.dataType==='Checkbox'||field?.dataType==='Boolean'
          ? String(value)==='true'?'Yes':String(value)==='false'?'No':'a value'
          : String(value??'').trim()||'a value';
      return [name,operatorLabels[operator]??operator,...(/Blank/i.test(operator)?[]:[label])].join(' ');
    });
  const additional=Math.max(0,rules.length-descriptions.length);
  return descriptions.join('; ')+(additional?`; +${additional} more`:'');
}
