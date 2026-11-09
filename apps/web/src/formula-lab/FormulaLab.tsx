import * as React from 'react';
import {apiRequest} from '../core/authentication/Client/authClient';
import './formulaLab.css';

type Row = Record<string, unknown>;
type FormulaBox = {label:string; formula:string; expected:number; money?:boolean};
const number = (v:unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const id = (v:unknown) => String(v??'');
const escaped = (v:string) => JSON.stringify(v);
const money = (v:number) => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(v);
const round = (v:number) => Math.round((v+Number.EPSILON)*100)/100;
const sum = (rows:Row[],field:string) => rows.reduce((n,r)=>n+number(r[field]),0);
const collection = (label:string,values:number[]) =>
  'COLLECTION('+[escaped(label),...(values.length?values:[0]).map(v=>String(round(v)))].join(',')+')';
const loadAll = async (object:string):Promise<Row[]> => {
  const rows:Row[]=[];let cursor:string|undefined;
  // Always paginate; a 100-record first page produces incorrect aggregate tests.
  for(let page=0;page<100;page++){
    const params=new URLSearchParams({limit:'100'});
    if(cursor)params.set('cursor',cursor);
    const payload=await apiRequest<{records?:Row[];nextCursor?:string|null;cursor?:string|null;hasMore?:boolean}>(
      '/records/'+encodeURIComponent(object)+'?'+params.toString());
    const batch=Array.isArray(payload.records)?payload.records:[];
    rows.push(...batch);
    const next=payload.nextCursor ?? (payload.hasMore?payload.cursor:null);
    if(!next || next===cursor){if(payload.hasMore&&batch.length===100)throw Error(object+' record pagination did not advance');return rows;}
    cursor=next;
  }
  throw Error(object+' has more than 10,000 records; refusing partial totals');
};
function makeBoxes(lines:Row[],products:Row[]):FormulaBox[]{
  const byId=new Map(products.map(p=>[id(p.Id),p]));
  const enriched=lines.map(line=>{
    const product=byId.get(id(line.Product));
    const name=id(product?.Name??line.Name);
    const quantity=number(line.Quantity), price=number(line.UnitPrice), total=number(line.LineTotal)||round(quantity*price);
    return {name,quantity,price,total,vat:round(total*.2),coke:/coke/i.test(name)};
  });
  const totals=enriched.map(x=>x.total),qty=enriched.map(x=>x.quantity),vat=enriched.map(x=>x.vat);
  const coke=enriched.filter(x=>x.coke),others=enriched.filter(x=>!x.coke);
  const total=round(totals.reduce((a,b)=>a+b,0)),units=qty.reduce((a,b)=>a+b,0);
  const unique=new Set(enriched.map(x=>id(lines[enriched.indexOf(x)]?.Product))).size;
  const s=(a:number[])=>round(a.reduce((n,v)=>n+v,0));
  const C=(name:string,a:number[])=>collection(name,a);
  const specs:FormulaBox[]=[
    {label:'Distinct products',formula:'COUNT('+C('DistinctProducts',Array.from(new Set(lines.map(x=>id(x.Product)))).map(()=>1))+')',expected:unique},
    {label:'Total item quantity',formula:'SUM('+C('Quantities',qty)+')',expected:units},
    {label:'VAT total (20%)',formula:'ROUND(SUM('+C('Vat',vat)+'),2)',expected:s(vat),money:true},
    {label:'Coke products total',formula:'ROUND(SUM('+C('Coke',coke.map(x=>x.total))+'),2)',expected:s(coke.map(x=>x.total)),money:true},
    {label:'Total × 1.2',formula:'ROUND(SUM('+C('LineTotals',totals)+')*1.2,2)',expected:round(total*1.2),money:true},
    {label:'Cart subtotal',formula:'ROUND(SUM('+C('Subtotal',totals)+'),2)',expected:total,money:true},
    {label:'Cart line count',formula:'COUNT('+C('Rows',qty.map(()=>1))+')',expected:lines.length},
    {label:'Average line total',formula:'IFERROR(ROUND(AVERAGE('+C('AverageLine',totals)+'),2),0)',expected:lines.length?round(total/lines.length):0,money:true},
    {label:'Highest line total',formula:'MAX('+C('MaxLine',totals)+')',expected:Math.max(0,...totals),money:true},
    {label:'Lowest line total',formula:'MIN('+C('MinLine',totals)+')',expected:totals.length?Math.min(...totals):0,money:true},
    {label:'Coke unit quantity',formula:'SUM('+C('CokeUnits',coke.map(x=>x.quantity))+')',expected:s(coke.map(x=>x.quantity))},
    {label:'Other products total',formula:'SUM('+C('OtherTotals',others.map(x=>x.total))+')',expected:s(others.map(x=>x.total)),money:true},
    {label:'Coke VAT',formula:'SUM('+C('CokeVAT',coke.map(x=>x.vat))+')',expected:s(coke.map(x=>x.vat)),money:true},
    {label:'Non-Coke VAT',formula:'SUM('+C('OtherVAT',others.map(x=>x.vat))+')',expected:s(others.map(x=>x.vat)),money:true},
    {label:'Total plus VAT',formula:'ROUND(SUM('+C('Gross',totals)+')+SUM('+C('Tax',vat)+'),2)',expected:round(total+s(vat)),money:true},
  ];
  for(const rate of [5,10,15,20,25,30,35,40,45,50]){
    specs.push({label:rate+'% of subtotal',formula:'ROUND(SUM('+C('Subtotal'+rate,totals)+')*'+rate+'/100,2)',expected:round(total*rate/100),money:true});
  }
  for(const threshold of [1,2,3,4,5,10,20,50,100,200]){
    const filtered=enriched.filter(x=>x.total>=threshold);
    specs.push({label:'SUMIF line ≥ £'+threshold,formula:'SUM('+C('AtLeast'+threshold,filtered.map(x=>x.total))+')',expected:s(filtered.map(x=>x.total)),money:true});
  }
  for(const threshold of [1,2,3,4,5]){
    const filtered=enriched.filter(x=>x.quantity>=threshold);
    specs.push({label:'SUMIFS qty ≥ '+threshold+' & Coke',formula:'IFERROR(ROUND(SUM('+C('CokeQty'+threshold,filtered.filter(x=>x.coke).map(x=>x.total))+'),2),0)',expected:s(filtered.filter(x=>x.coke).map(x=>x.total)),money:true});
    specs.push({label:'SUMIFS qty ≥ '+threshold+' & non-Coke',formula:'IFERROR(ROUND(SUM('+C('OtherQty'+threshold,filtered.filter(x=>!x.coke).map(x=>x.total))+'),2),0)',expected:s(filtered.filter(x=>!x.coke).map(x=>x.total)),money:true});
  }
  for(const threshold of [10,25,50,100,200]){
    const matched=enriched.filter(x=>x.total>=threshold&&x.quantity>=2);
    specs.push({label:'SUMIFS total ≥ £'+threshold+' & qty ≥ 2',formula:'IFERROR(ROUND(SUM('+C('Multi'+threshold,matched.map(x=>x.total))+'),2),0)',expected:s(matched.map(x=>x.total)),money:true});
  }
  return specs.slice(0,50);
}
export default function FormulaLab(){
  const [products,setProducts]=React.useState<Row[]>([]);
  const [lines,setLines]=React.useState<Row[]>([]);
  const [cart,setCart]=React.useState<Row|null>(null);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [results,setResults]=React.useState<Record<number,{value:unknown;error?:string}>>({});
  const [search,setSearch]=React.useState('');
  const [generation,setGeneration]=React.useState(0);
  const refresh=React.useCallback(async()=>{
    try{
      setError('');
      const [allProducts,allCarts,allLines]=await Promise.all([loadAll('Product'),loadAll('Cart'),loadAll('CartLine')]);
      const sessionCart=allCarts.find(x=>id(x.Name)==='Formula Lab Test Cart'&&id(x.Status)!=='Closed');
      setProducts(allProducts);setCart(sessionCart??null);
      setLines(allLines.filter(x=>id(x.Cart)===id(sessionCart?.Id)&&Boolean(sessionCart)));
      setGeneration(v=>v+1);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  },[]);
  React.useEffect(()=>{void refresh();},[refresh]);
  const add=async(product:Row)=>{
    if(busy)return;setBusy(true);setError('');
    try{
      let active=cart;
      if(!active){
        const created=await apiRequest<{record:Row}>('/records/Cart',{method:'POST',body:JSON.stringify({Name:'Formula Lab Test Cart',Status:'Open',Subtotal:0,Tax:0,Total:0})});
        active=created.record;setCart(active);
      }
      const price=number(product.Price);
      const existing=lines.find(x=>id(x.Product)===id(product.Id));
      if(existing){
        const quantity=number(existing.Quantity)+1;
        await apiRequest('/records/CartLine/'+encodeURIComponent(id(existing.Id)),{method:'PUT',body:JSON.stringify({Quantity:quantity,LineTotal:round(quantity*number(existing.UnitPrice))})});
      }else{
        await apiRequest('/records/CartLine',{method:'POST',body:JSON.stringify({Name:id(product.Name),Cart:id(active.Id),Product:id(product.Id),Quantity:1,UnitPrice:price,LineTotal:price,Status:'Open'})});
      }
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const remove=async(line:Row)=>{
    if(busy)return;setBusy(true);setError('');
    try{await apiRequest('/records/CartLine/'+encodeURIComponent(id(line.Id)),{method:'DELETE'});await refresh();}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const boxes=React.useMemo(()=>makeBoxes(lines,products),[lines,products]);
  React.useEffect(()=>{
    let alive=true;
    setResults({});
    // Bounded concurrency so 50 formula tests do not exhaust the SQL pool.
    (async()=>{
      let next=0;
      await Promise.all(Array.from({length:4},async()=>{
        while(alive){
          const index=next++;if(index>=boxes.length)return;
          try{
            const output=await apiRequest<{value:unknown}>('/formulas/evaluate',{
              method:'POST',body:JSON.stringify({formula:boxes[index].formula,objectApi:'Cart',recordId:cart?.Id})});
            if(alive)setResults(prev=>({...prev,[index]:{value:output.value}}));
          }catch(e){if(alive)setResults(prev=>({...prev,[index]:{value:null,error:e instanceof Error?e.message:String(e)}}));}
        }
      }));
    })();
    return()=>{alive=false;};
  },[boxes,generation,cart?.Id]);
  const displayed=products.filter(p=>id(p.Name).toLowerCase().includes(search.toLowerCase())||id(p.SKU).toLowerCase().includes(search.toLowerCase()));
  return <main className="formula-lab">
    <header className="lab-heading"><div><p>Standalone test page · Existing Product / Cart / CartLine objects</p><h1>Cart & Formula Lab</h1><small>Hardcoded React UI. Each result comes from the server formula evaluator; failures are visible.</small></div><button onClick={()=>void refresh()} disabled={busy}>Refresh data</button></header>
    {error&&<div role="alert" className="lab-error">{error}</div>}
    <div className="lab-layout"><section><div className="lab-section-header"><h2>Products ({products.length})</h2><input aria-label="Search products" placeholder="Search name or SKU" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="lab-products">{displayed.map(p=><button key={id(p.Id)} className="lab-product" disabled={busy} onClick={()=>void add(p)}><strong>{id(p.Name)}</strong><small>{id(p.SKU)}</small><span>{money(number(p.Price))} <b>+ Add</b></span></button>)}</div></section>
    <aside className="lab-cart"><h2>Cart ({lines.length} lines)</h2>{!lines.length&&<p>Click a product card to add it.</p>}{lines.map(l=><div className="lab-line" key={id(l.Id)}><div><strong>{id(l.Name)}</strong><small>Qty {number(l.Quantity)} × {money(number(l.UnitPrice))}</small></div><strong>{money(number(l.LineTotal))}</strong><button onClick={()=>void remove(l)} disabled={busy} aria-label={'Remove '+id(l.Name)}>×</button></div>)}<div className="lab-cart-total">Subtotal <strong>{money(sum(lines,'LineTotal'))}</strong></div><small>Test cart record: {id(cart?.Id)||'Not created yet'}</small></aside></div>
    <div className="lab-section-header"><h2>50 live formula tests</h2><span>{Object.keys(results).length} / {boxes.length} evaluated</span></div>
    <div className="lab-metrics">{boxes.map((box,i)=>{const result=results[i];const actual=number(result?.value);const matches=result&&!result.error&&typeof result.value==='number'&&Math.abs(actual-box.expected)<0.011;return <article className={'lab-metric '+(result?.error?'is-error':result?(matches?'is-pass':'is-mismatch'):'')} key={i}><div className="lab-metric-label"><span>{i+1}. {box.label}</span><b>{!result?'…':result.error?'ERROR':matches?'PASS':'CHECK'}</b></div><strong>{!result?'Calculating…':result.error?'Formula error':typeof result.value==='number'?(box.money?money(actual):actual.toLocaleString('en-GB')):String(result.value??'null')}</strong><small>Expected: {box.money?money(box.expected):box.expected}</small><details><summary>Formula / details</summary><code>{box.formula}</code>{result?.error&&<p role="alert">{result.error}</p>}</details></article>;})}</div>
  </main>;
}
