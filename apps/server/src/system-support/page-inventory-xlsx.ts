import {readLoaderWorkbook,writeLoaderWorkbook,type LoaderTable} from './metadata-loader-xlsx.js';
import {INVENTORY_EXPORT_COLUMNS,inventoryCsv,inventoryCsvTable} from './page-inventory-csv.js';

/** Page Builder upload/download as ONE Excel workbook: "Pages" (the data you edit and
 * upload), "Guide" (what every column and special property means) and "Sample"
 * (ready-made rows to copy). Only the "Pages" sheet is read back. */
export const PAGE_SHEET='Pages';
const GUIDE:Array<[string,string,string]>=[
 ['How to use','Big downloads continue on sheets Pages 2, Pages 3... (all are uploaded). 1. Change values in the Pages sheet (add rows to add properties or components). 2. Save as .xlsx. 3. Page Builder > Upload > choose the file > Validate > Apply.','Only the Pages sheet is uploaded; Guide and Sample are ignored. Blank value = no change.'],
 ['pageapi','Page API name, e.g. smart_till_payment.','Must be an existing page.'],
 ['component_type','Component type without "Custom:", e.g. smart_button, smart_container, smart_multipage.','A new component_name with a type creates the component.'],
 ['component_name','The component name shown in Layers, e.g. PayConfirm.','Unique on the page.'],
 ['propertyid','The property to set (see rows below for special ones). Ribbon properties use their key, e.g. label, textSource, visibleFormula, backgroundColor.','Download a page to see every property it has.'],
 ['value','The new value. Formulas start with =.','Text that is a formula in the app is sent exactly as written; Excel formulas are not accepted.'],
 ['layout','Desktop, Tablet, Mobile or Custom.','Blank = the layout chosen on upload.'],
 ['ribbon_tab','Where the property sits in the ribbon (Data, Design, Actions...).','Information only.'],
 ['component.position.x / y','Left / top in pixels. Inside a container: counted from the container\'s top-left corner.','Each layout keeps its own positions.'],
 ['component.position.width / height','Size in pixels.','Must be more than 0.'],
 ['component.parent','Name of the container this component sits in (Smart Container, Smart MultiPage page...). none = on the page.','Containers can be inside containers.'],
 ['component.visible','TRUE or FALSE.',''],
 ['pageLayer','Layer 0-9 (only one layer shows at a time).','0 = default layer.'],
 ['actionFlows','Events as JSON, e.g. {"click":{"actionType":"Formula","formula":"=SCREEN(page, popup)"}}.','Easier: copy from a downloaded page.'],
 ['Smart MultiPage','multiPageVisible (Visible tabs), multiPageActive (Active tab), multiPageTabBar, multiPageTabStyle, multiPageEmptyText. Each child container is one page; its Page key (pageKey) or name is the tab.','See the Sample sheet.']
];
const SAMPLE:string[][]=[
 ['my_page','smart_multipage','PayHelper','component.position.x','32','Custom','Layout'],
 ['my_page','smart_multipage','PayHelper','component.position.y','224','Custom','Layout'],
 ['my_page','smart_multipage','PayHelper','multiPageVisible','=@ThisPage.Mode1.Value & "," & @ThisPage.Mode2.Value','Custom','Design2'],
 ['my_page','smart_container','Cash','component.parent','PayHelper','Custom','Layout'],
 ['my_page','smart_button','Note10','component.parent','Cash','Custom','Layout'],
 ['my_page','smart_button','Note10','component.position.x','0','Custom','Layout'],
 ['my_page','smart_button','Note10','component.position.y','0','Custom','Layout'],
 ['my_page','smart_button','Note10','label','£10','Custom','Data'],
 ['my_page','smart_button','Note10','actionFlows','{"click":{"actionType":"Formula","formula":"=@ThisPage.cash.Value = \\"10\\""}}','Custom','Actions'],
 ['my_page','smart_container','PayPal','component.parent','PayHelper','Custom','Layout'],
 ['my_page','smart_qr','PayQr','component.parent','PayPal','Custom','Layout']
];
const table=(name:string,columns:string[],rows:string[][]):LoaderTable=>({name,columns,
 rows:rows.map(row=>Object.fromEntries(columns.map((column,i)=>[column,row[i]??''])))});

/** Page CSV (as downloaded today) -> one workbook with Pages, Guide and Sample sheets. */
export function inventoryWorkbook(csv:string):Buffer{
 const {header,rows,issues}=inventoryCsvTable(csv);
 if(issues.length&&!rows.length)throw Error(issues[0].remark);
 const columns=header.length?header:[...INVENTORY_EXPORT_COLUMNS];
 // A sheet holds up to 9,000 rows: big downloads continue on "Pages 2", "Pages 3"...
 const chunks:string[][][]=[];
 for(let i=0;i<Math.max(rows.length,1);i+=9000)chunks.push(rows.slice(i,i+9000));
 if(chunks.length>18)throw Error('Too many rows for one workbook: download fewer pages');
 return writeLoaderWorkbook([
  ...chunks.map((chunk,i)=>table(i?PAGE_SHEET+' '+(i+1):PAGE_SHEET,columns,chunk)),
  table('Guide',['Column or property','What it means','Notes'],GUIDE),
  table('Sample',[...INVENTORY_EXPORT_COLUMNS],SAMPLE)
 ]);
}
/** Uploaded workbook -> the page CSV the normal validate/apply steps read. */
export function inventoryCsvFromWorkbook(bytes:Buffer):string{
 const sheets=readLoaderWorkbook(bytes);
 const pages=sheets.filter(s=>/^pages( \d+)?$/i.test(s.name.trim()));
 const used=pages.length?pages:sheets.slice(0,1);
 if(!used.length)throw Error('The workbook has no Pages sheet');
 const columns=used[0].columns.filter(Boolean);
 return inventoryCsv([columns,...used.flatMap(sheet=>sheet.rows.map(row=>columns.map(column=>row[column]??'')))]);
}
