import * as React from 'react';
import './document-print.css';

/** Universal read-only document presentation. All data is supplied by an authorised
 * Get Records Flow; this component does not compute financial values or mutate data.
 */
type Row=Record<string,unknown>;
export type DocumentPrintProps={objectLabel:string;document:Row;lines:Row[];
 currency?:string;onClose:()=>void};
const display=(v:unknown)=>v===null||v===undefined?'':String(v);
const number=(v:unknown)=>v===null||v===undefined?'':Number.isFinite(Number(v))
 ?Number(v).toFixed(2):String(v);
export function DocumentPrint({objectLabel,document,lines,currency,onClose}:DocumentPrintProps){
 const symbol=currency||display(document.CurrencyCode)||'';
 const columns=['Name','Description','Quantity','UnitPrice','DiscountAmount','TaxAmount','LineTotal'];
 return <div className="md-document-print-overlay" role="dialog" aria-modal="true"
  aria-label={objectLabel+' printable preview'}>
  <div className="md-document-print-toolbar">
   <strong>{objectLabel} preview</strong>
   <button type="button" onClick={()=>window.print()}>Print / Save PDF</button>
   <button type="button" onClick={onClose}>Close</button>
  </div>
  <article className="md-document-print" aria-label={objectLabel+' document'}>
   <header>
    <div>
     <p className="md-document-print-overline">BUSINESS DOCUMENT</p>
     <h1>{objectLabel}</h1>
    </div>
    <div className="md-document-print-number">
     <strong>{display(document.InvoiceNumber??document.QuotationNumber??document.DocumentNumber??document.Name)}</strong>
     <span>{display(document.Status)}</span>
    </div>
   </header>
   <dl className="md-document-print-details">
    {['Name','Customer','IssueDate','InvoiceDate','DueDate','ExpiryDate','CurrencyCode']
     .filter(field=>document[field]!==null&&document[field]!==undefined&&document[field]!=='')
     .map(field=><div key={field}><dt>{field.replace(/([a-z])([A-Z])/g,'$1 $2')}</dt>
      <dd>{display(document[field])}</dd></div>)}
   </dl>
   <table>
    <thead><tr>{columns.map(label=><th key={label}>{label.replace(/([a-z])([A-Z])/g,'$1 $2')}</th>)}</tr></thead>
    <tbody>{lines.map((line,index)=><tr key={display(line.Id)||String(index)}>
     {columns.map(key=><td key={key}>{['Quantity','UnitPrice','DiscountAmount','TaxAmount','LineTotal']
       .includes(key)?number(line[key]):display(line[key])}</td>)}
    </tr>)}</tbody>
   </table>
   <dl className="md-document-print-totals">
    {['Subtotal','DiscountAmount','TaxAmount','Total','AmountPaid']
     .filter(field=>document[field]!==null&&document[field]!==undefined)
     .map(field=><div key={field}><dt>{field.replace(/([a-z])([A-Z])/g,'$1 $2')}</dt>
      <dd>{symbol} {number(document[field])}</dd></div>)}
   </dl>
   {Boolean(document.Notes)&&<section><h2>Notes</h2><p>{display(document.Notes)}</p></section>}
   <footer>Generated from authorised MetaDrive records. This preview does not change document status.</footer>
  </article>
 </div>;
}
