/** Smart Chart data shaping. Pure functions: no fetching, no formulas, no DOM.
 * Records arrive from the shared Page Runtime (Object records or a TABLE()
 * Items-source formula); the renderer passes label/value readers that use the
 * shared formula engine. This module only groups, sorts, limits and formats.
 */
export const CHART_TYPES=['bar','horizontal','line','donut'];
export const CHART_SORTS=['none','desc','asc'];
export const DEFAULT_CHART_COLOURS=['#007aff','#34c759','#ff9500','#af52de','#ff3b30','#5ac8fa'];

const bounded=(value,fallback,min,max)=>{
 const n=Number(value);
 return value!==''&&value!==null&&value!==undefined&&Number.isFinite(n)
  ?Math.max(min,Math.min(max,Math.round(n))):fallback;
};
const flag=(value,fallback)=>value===true||value==='true'?true:
 value===false||value==='false'?false:fallback;
const colour=(value,fallback)=>typeof value==='string'&&value.trim()?value.trim():fallback;

export function chartSettings(p={}){
 const type=CHART_TYPES.includes(p.chartType)?p.chartType:'bar';
 return {
  type,
  sort:CHART_SORTS.includes(p.chartSort)?p.chartSort:'none',
  maxItems:bounded(p.chartMaxItems,12,1,50),
  decimals:bounded(p.chartDecimals,0,0,4),
  showValues:flag(p.chartShowValues,true),
  showGrid:flag(p.chartShowGrid,type!=='donut'),
  showLegend:flag(p.chartShowLegend,type==='donut'),
  prefix:p.chartValuePrefix===undefined||p.chartValuePrefix===null?'':String(p.chartValuePrefix),
  colours:DEFAULT_CHART_COLOURS.map((fallback,i)=>colour(p['chartColor'+(i+1)],fallback))
 };
}

/** Turn any value (number, "£12.50", "1,200") into a number; blanks become 0. */
export function chartNumber(value){
 if(typeof value==='number')return Number.isFinite(value)?value:0;
 if(typeof value==='boolean')return value?1:0;
 const text=String(value??'').replace(/[^0-9.\-]/g,'');
 const n=Number(text);
 return text&&Number.isFinite(n)?n:0;
}

/** Group rows by label (summing values), then sort and limit. */
export function chartPoints(rows,labelOf,valueOf,settings){
 const groups=new Map();
 for(const row of Array.isArray(rows)?rows:[]){
  const raw=labelOf(row);
  const label=raw===undefined||raw===null||raw===''?'(blank)':String(raw);
  groups.set(label,(groups.get(label)??0)+chartNumber(valueOf(row)));
 }
 let points=[...groups].map(([label,value])=>({label,value}));
 if(settings.sort==='desc')points.sort((a,b)=>b.value-a.value);
 if(settings.sort==='asc')points.sort((a,b)=>a.value-b.value);
 points=points.slice(0,settings.maxItems);
 return points.map((point,index)=>({...point,
  colour:settings.type==='donut'?settings.colours[index%settings.colours.length]:settings.colours[0]}));
}

export function formatChartValue(value,settings){
 const fixed=Number(value).toLocaleString('en-GB',{
  minimumFractionDigits:settings.decimals,maximumFractionDigits:settings.decimals});
 return settings.prefix+fixed;
}

/** Nice axis maximum: 0..max rounded up to 1, 2, 2.5 or 5 x 10^n. */
export function chartAxisMax(points){
 const top=Math.max(0,...points.map(point=>point.value));
 if(top<=0)return 1;
 const power=10**Math.floor(Math.log10(top));
 const step=[1,2,2.5,5,10].find(m=>m*power>=top)??10;
 return step*power;
}

/** Donut arcs as fractions of the whole, for an SVG stroke-dasharray. */
export function donutSegments(points){
 const total=points.reduce((sum,point)=>sum+Math.max(0,point.value),0);
 if(total<=0)return [];
 let start=0;
 return points.map(point=>{
  const share=Math.max(0,point.value)/total;
  const segment={...point,share,start};
  start+=share;
  return segment;
 });
}

export const CHART_PREVIEW_ROWS=[
 {Id:'preview-1',Label:'Mon',Value:820},{Id:'preview-2',Label:'Tue',Value:640},
 {Id:'preview-3',Label:'Wed',Value:910},{Id:'preview-4',Label:'Thu',Value:760},
 {Id:'preview-5',Label:'Fri',Value:1240},{Id:'preview-6',Label:'Sat',Value:1480}
];
