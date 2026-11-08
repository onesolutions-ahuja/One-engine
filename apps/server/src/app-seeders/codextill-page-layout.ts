import {createHash} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {PageRuntime} from '../system-files/page-runtime.js';

/**
 * Add the approved visual-only Smart Component layout to the unique existing
 * CODEXTILL page. No new page, component definitions, bindings, or publishing.
 * A completion receipt makes this a one-time update, not an ongoing seeder.
 */
const RECEIPT='codextill-smart-layout-desktop-20261101-v1';
type SmartBlock={
 id:string;type:string;label:string;region:'main'|'header'|'sidebar';
 visible:true;position:{x:number;y:number;width:number;height:number};
 parentId?:string;properties:Record<string,unknown>;
};
const block=(key:string,api:string,label:string,region:SmartBlock['region'],
 x:number,y:number,width:number,height:number,parent?:string,
 visual:Record<string,unknown>={}):SmartBlock=>{
 const id='codextill-'+key;
 return {id,type:'Custom:'+api,label,region,visible:true,
  position:{x,y,width,height},
  ...(parent?{parentId:'codextill-'+parent}:{}),
  properties:{libraryComponentId:api,...(parent?{layoutParentId:'codextill-'+parent}:{}),...visual}
 };
};

export const codextillDesktopComponents:SmartBlock[]=[
 block('root','smart_container','CODEXTILL canvas','main',0,0,1920,889,undefined,
  {layoutContainer:true,backgroundColor:'#FFFFFF'}),
 block('header','smart_container','Header','header',0,0,1920,109,'root',
  {layoutContainer:true,backgroundColor:'#FFFFFF'}),
 block('products-panel','smart_container','Product section','main',0,109,1325,780,'root',
  {layoutContainer:true,backgroundColor:'#FFFFFF'}),
 block('order-panel','smart_container','Order section','sidebar',1325,109,595,780,'root',
  {layoutContainer:true,backgroundColor:'#FFFFFF'}),
 block('action-bar','smart_container','Bottom action bar','main',32,676,1260,82,'products-panel',
  {layoutContainer:true,backgroundColor:'#FFFFFF'}),
 block('brand-logo','smart_image','Smart Till logo','header',54,25,60,60,'header',
  {backgroundColor:'#0A2F5F',radius:16}),
 block('brand-text','smart_container','Smart Till point of sale','header',130,32,200,52,'header',
  {backgroundColor:'#FFFFFF'}),
 block('till-lock','smart_icon','Till lock','header',1120,25,60,60,'header',
  {backgroundColor:'#FAFAFC',iconFillColor:'#172033'}),
 block('settings','smart_icon','Settings','header',1194,25,58,60,'header',
  {backgroundColor:'#FAFAFC',iconFillColor:'#172033'}),
 block('customer-display','smart_button','Customer display','header',1262,28,203,56,'header',
  {label:'Customer display',backgroundColor:'#FAFAFC',labelColor:'#172033',radius:14}),
 block('held-sales-top','smart_button','Held sales','header',1476,28,119,56,'header',
  {label:'Held sales',backgroundColor:'#FAFAFC',labelColor:'#172033',radius:14}),
 block('sales-return','smart_button','Sales return','header',1606,28,138,56,'header',
  {label:'Sales return',backgroundColor:'#FAFAFC',labelColor:'#172033',radius:14}),
 block('sign-out','smart_button','Sign out','header',1758,28,111,56,'header',
  {label:'Sign out',backgroundColor:'#FAFAFC',labelColor:'#172033',radius:14}),
 block('categories','smart_tabs','Product categories','main',33,33,862,63,'products-panel',
  {tabCount:8,tabHeight:56,tabs:['All items','Burgers','Buckets','Chicken','Wraps','Sides','Drinks','Desserts'],
   tabColor:'#FFFFFF',selectedTabColor:'#F2F5FA',labelColor:'#153B64'}),
 block('search','smart_lookup','Search products','main',908,33,384,67,'products-panel',
  {placeholder:'Search or scan products',backgroundColor:'#FFFFFF',borderColor:'#DCE3ED',radius:16}),
 block('product-grid','smart_card_grid','Product catalogue','main',33,142,1259,534,'products-panel',
  {cardsPerRow:5,imageHeight:190,gap:16,backgroundColor:'#FFFFFF',borderColor:'#DCE3ED',radius:16}),
 block('cart','smart_cart','Current order','sidebar',29,42,538,620,'order-panel',
  {backgroundColor:'#FFFFFF',tableBackgroundColor:'#FFFFFF',headerTextColor:'#172033',
   rowLabelColor:'#354052'}),
 block('clear-order','smart_icon','Clear order','sidebar',522,46,28,28,'order-panel',
  {backgroundColor:'transparent',iconFillColor:'#374151'}),
 block('cash','smart_button','Cash','sidebar',29,675,260,75,'order-panel',
  {label:'Cash',backgroundColor:'#7FB9A2',labelColor:'#FFFFFF',radius:15}),
 block('card','smart_button','Card','sidebar',306,675,261,75,'order-panel',
  {label:'Card',backgroundColor:'#788CA6',labelColor:'#FFFFFF',radius:15}),
 block('hold-label','smart_text','Hold sale label','main',1,20,203,56,'action-bar',
  {placeholder:'Hold sale label',backgroundColor:'#3B3B3B',labelColor:'#A3A3A3'}),
 block('hold-sale','smart_button','Hold sale','main',213,20,201,56,'action-bar',
  {label:'Hold sale',backgroundColor:'#FFFFFF',labelColor:'#8295B0',radius:14}),
 block('discount','smart_button','Discount','main',422,20,205,56,'action-bar',
  {label:'Discount',backgroundColor:'#FFFFFF',labelColor:'#8295B0',radius:14}),
 block('rewards','smart_button','Rewards','main',635,20,202,56,'action-bar',
  {label:'Rewards',backgroundColor:'#FFFFFF',labelColor:'#8295B0',radius:14}),
 block('gift-cards','smart_button','Gift cards','main',847,20,202,56,'action-bar',
  {label:'Gift cards',backgroundColor:'#FFFFFF',labelColor:'#8295B0',radius:14}),
 block('more','smart_button','More','main',1058,20,202,56,'action-bar',
  {label:'More',backgroundColor:'#FFFFFF',labelColor:'#8295B0',radius:14})
];

export async function applyCodextillDesktopLayout(db:SqlPersistence):Promise<number>{
 const checksum=createHash('sha256').update(JSON.stringify(codextillDesktopComponents)).digest('hex');
 const receipt=await db.query<{checksum:string}>('SELECT checksum FROM md_system_migrations WHERE version=$1',[RECEIPT]);
 if(receipt.rows[0]){
  if(receipt.rows[0].checksum!==checksum)throw Error('CODEXTILL layout receipt checksum mismatch');
  return 0;
 }
 // Exact API name and a unique tenant match. Never alter another tenant's page,
 // app-owned pages, or a similarly named page when the match is ambiguous.
 const found=await db.query<{tenant_id:string}>(`
  SELECT p.tenant_id FROM md_page_definitions p
  JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
  WHERE p.api_name='CODEXTILL' AND p.enabled=true
    AND NOT EXISTS(SELECT 1 FROM md_app_seed_pages s
      WHERE s.tenant_id=p.tenant_id AND s.page_id=p.id)`);
 if(found.rows.length!==1){
  console.info('[CODEXTILL] visual draft not applied: expected one editable CODEXTILL page, found',found.rows.length);
  return 0;
 }
 const tenant=found.rows[0].tenant_id;
 const pages=new PageRuntime(db);
 const current=await pages.editor(tenant,'CODEXTILL','Desktop');
 if(!['App Page','Home Page'].includes(current.pageType))
  throw Error('CODEXTILL is not an App/Home Page');
 const existing=new Set(current.components.map(component=>component.id));
 const needed=codextillDesktopComponents.filter(component=>!existing.has(component.id));
 if(needed.length){
  await pages.saveLayoutDraft(tenant,'CODEXTILL','Desktop',{
   ...current,layoutMode:'free-canvas',
   canvasWidth:Math.max(1920,current.canvasWidth),
   canvasHeight:Math.max(889,current.canvasHeight),
   components:[...current.components,...needed]
  });
 }
 await db.query(`INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)
  ON CONFLICT(version) DO NOTHING`,[RECEIPT,checksum]);
 console.info('[CODEXTILL] saved visual Desktop draft with',needed.length,'new Smart Components');
 return needed.length;
}
