import {smartShapes} from "../../smart_icon/SmartShapes";

/** One shape geometry source: the exact paths already displayed by the Layout gallery.
 * The SVG mask scales to the native surface, including lines and flowchart shapes.
 * Existing controls without shapeId retain their original radius and appearance.
 */
const shapeMasks=new Map(smartShapes.map(shape=>{
 const markup='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" preserveAspectRatio="none">'+
   (shape.ellipse?'<ellipse cx="12" cy="12" rx="10" ry="8" fill="white"/>':
     '<path d="'+shape.path+'" fill="'+(shape.outline?'none':'white')+
     '" stroke="white" stroke-width="'+(shape.outline?'2':'0')+
     '" stroke-linejoin="round" stroke-linecap="round"/>')+'</svg>';
 return [shape.id,'url("data:image/svg+xml,'+encodeURIComponent(markup)+'")'];
}));
export function smartShapeAppearance(id,radius=12){
 if(id==='shape:oval')return {borderRadius:'50%'};
 if(id==='shape:round-rectangle')return {borderRadius:Math.max(14,Number(radius)||12)};
 const mask=shapeMasks.get(id);
 if(!mask||id==='shape:rectangle')return {borderRadius:radius};
 return {borderRadius:0,
   WebkitMaskImage:mask,maskImage:mask,
   WebkitMaskSize:'100% 100%',maskSize:'100% 100%',
   WebkitMaskRepeat:'no-repeat',maskRepeat:'no-repeat'};
}
