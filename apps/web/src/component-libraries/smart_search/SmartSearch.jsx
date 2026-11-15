/** Smart Search: a plain search box (no dropdown list).
 * On Change fires with the typed text once it has at least 3 letters (and once
 * with "" when it drops below 3), 250 ms after the last key, so typing "coca"
 * runs one query. On Enter fires at once with the text, for barcode scanners;
 * a scanned code (no spaces, contains a digit) is then cleared for the next scan. */
const MIN_LETTERS=3;
const DEBOUNCE_MS=250;
export default function SmartSearch({p,fire,placeholder,style}){
 const [query,setQuery]=React.useState("");
 const timer=React.useRef(null);
 const lastFired=React.useRef("");
 const minimum=Number.isInteger(Number(p.searchMinChars))&&Number(p.searchMinChars)>0?Number(p.searchMinChars):MIN_LETTERS;
 React.useEffect(()=>()=>clearTimeout(timer.current),[]);
 const publish=value=>{
  const term=value.trim().length>=minimum?value.trim():"";
  if(term===lastFired.current)return;
  lastFired.current=term;
  fire("change",term);
 };
 const type=value=>{
  setQuery(value);
  clearTimeout(timer.current);
  timer.current=setTimeout(()=>publish(value),DEBOUNCE_MS);
 };
 const clear=()=>{clearTimeout(timer.current);setQuery("");publish("");};
 const enter=()=>{
  clearTimeout(timer.current);
  const value=query.trim();
  if(!value)return;
  fire("enter",value);
  // A scanned code (no spaces, has a digit, e.g. 5012345678900 or DEMO10001) is
  // cleared for the next scan; typed words stay as the search.
  if(/^(?=\S*\d)\S{4,}$/.test(value))clear();else publish(query);
 };
 return <div className="smart-search-box" data-design-area={p.builderPreview?"Body":undefined}
  style={{...style,"--smart-placeholder-color":p.labelColor||undefined}}>
  <span className="smart-search-icon" aria-hidden="true"
   style={{WebkitMaskImage:"url(/smart-icons/search.svg)",maskImage:"url(/smart-icons/search.svg)"}}/>
  <input data-md-bind={p.builderPreview?"label":undefined} data-md-bind-titles={p.builderPreview?"Search placeholder":undefined}
   className="smart-search-input" type="search" inputMode="search" enterKeyHint="search" autoComplete="off" spellCheck={false}
   aria-label={placeholder||"Search"} placeholder={placeholder||"Search"} value={query}
   readOnly={Boolean(p.builderPreview||p.previewOnly)}
   style={{textAlign:p.labelAlignment||"left"}}
   onChange={event=>type(event.target.value)}
   onKeyDown={event=>{
    if(event.key==="Enter"){event.preventDefault();enter();}
    else if(event.key==="Escape"&&query){event.preventDefault();clear();}
   }}/>
  {query&&<button type="button" className="smart-search-clear" aria-label="Clear search" onClick={clear}>✕</button>}
 </div>;
}
