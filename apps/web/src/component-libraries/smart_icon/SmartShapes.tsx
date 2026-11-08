import type {CSSProperties} from 'react';
export type SmartShape={id:string;label:string;category:string;path?:string;ellipse?:boolean;outline?:boolean};
export const smartShapes:readonly SmartShape[]=[
 {id:'shape:line',label:'Line',category:'Lines',path:'M2 20 L22 4',outline:true},
 {id:'shape:arrow-line',label:'Arrow line',category:'Lines',path:'M2 20 L22 4 M14 4 H22 V12',outline:true},
 {id:'shape:elbow',label:'Elbow connector',category:'Lines',path:'M3 3 H12 V21 H21',outline:true},
 {id:'shape:curve',label:'Curve',category:'Lines',path:'M2 20 Q12 -6 22 4',outline:true},
 {id:'shape:rectangle',label:'Rectangle',category:'Rectangles',path:'M3 4 H21 V20 H3 Z'},
 {id:'shape:round-rectangle',label:'Rounded rectangle',category:'Rectangles',path:'M7 4 H17 Q21 4 21 8 V16 Q21 20 17 20 H7 Q3 20 3 16 V8 Q3 4 7 4 Z'},
 {id:'shape:oval',label:'Oval',category:'Basic Shapes',ellipse:true},
 {id:'shape:triangle',label:'Triangle',category:'Basic Shapes',path:'M12 3 L22 21 H2 Z'},
 {id:'shape:diamond',label:'Diamond',category:'Basic Shapes',path:'M12 2 L22 12 L12 22 L2 12 Z'},
 {id:'shape:pentagon',label:'Pentagon',category:'Basic Shapes',path:'M12 2 L22 10 L18 22 H6 L2 10 Z'},
 {id:'shape:hexagon',label:'Hexagon',category:'Basic Shapes',path:'M7 2 H17 L23 12 L17 22 H7 L1 12 Z'},
 {id:'shape:cross',label:'Cross',category:'Basic Shapes',path:'M8 2 H16 V8 H22 V16 H16 V22 H8 V16 H2 V8 H8 Z'},
 {id:'shape:arrow-right',label:'Right arrow',category:'Block Arrows',path:'M2 8 H13 V3 L23 12 L13 21 V16 H2 Z'},
 {id:'shape:arrow-left',label:'Left arrow',category:'Block Arrows',path:'M22 8 H11 V3 L1 12 L11 21 V16 H22 Z'},
 {id:'shape:arrow-up',label:'Up arrow',category:'Block Arrows',path:'M8 22 V11 H3 L12 1 L21 11 H16 V22 Z'},
 {id:'shape:arrow-down',label:'Down arrow',category:'Block Arrows',path:'M8 2 V13 H3 L12 23 L21 13 H16 V2 Z'},
 {id:'shape:decision',label:'Decision',category:'Flowchart',path:'M12 2 L23 12 L12 22 L1 12 Z'},
 {id:'shape:document',label:'Document',category:'Flowchart',path:'M3 2 H21 V18 Q16 14 12 18 Q8 22 3 18 Z'},
 {id:'shape:terminator',label:'Terminator',category:'Flowchart',path:'M8 4 H16 A8 8 0 0 1 16 20 H8 A8 8 0 0 1 8 4 Z'},
 {id:'shape:star',label:'Five-point star',category:'Stars & Banners',path:'M12 2 L15 9 H23 L17 14 L19 22 L12 17 L5 22 L7 14 L1 9 H9 Z'},
 {id:'shape:banner',label:'Banner',category:'Stars & Banners',path:'M2 3 H22 V21 L12 16 L2 21 Z'}
];
export function SmartShapeGlyph({id,size='100%',color='currentColor'}:{
 id:string;size?:string|number;color?:string
}){
 const shape=smartShapes.find(item=>item.id===id);
 if(!shape)return null;
 return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size}
  fill={shape.outline?'none':color} stroke={color} strokeWidth="1.5"
  strokeLinejoin="round" strokeLinecap="round" style={{display:'block',flexShrink:0} as CSSProperties}>
  {shape.ellipse?<ellipse cx="12" cy="12" rx="10" ry="8"/>:<path d={shape.path}/>}
 </svg>;
}
