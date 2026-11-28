/** Friendly "nothing here yet" for lists (Cart, Table): a large grey outline icon, a bold title and
 * a grey line under it, centred in the component (like the Apple Store bag). The title and the
 * line come from the component's properties (emptyText / emptySubtitle), else sensible defaults. */
// Outline paths per icon (drawn inside the component, never at module load).
const shapes={
 bag:["M6 8h12l-1 12H7L6 8z","M9 8V6a3 3 0 0 1 6 0v2"],
 table:["M5.5 5h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z","M3.5 10h17M3.5 14.5h17M9.5 10v9"]
};
export default function SmartEmptyState({icon="bag",title,subtitle,className="",designArea}){
 return <div className={"smart-empty-state "+className} role="status" data-design-area={designArea}>
  <svg className="smart-empty-state-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none"
   stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{(shapes[icon]??shapes.bag).map(d=><path key={d} d={d}/>)}</svg>
  {title?<strong className="smart-empty-state-title">{title}</strong>:null}
  {subtitle?<span className="smart-empty-state-subtitle">{subtitle}</span>:null}
 </div>;
}
