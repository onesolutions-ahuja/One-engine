import icons from "./iconCatalog.json";
/** Paint for one library icon. Monochrome icons are an SVG mask in `color`. Brand icons
 * (catalog "colored": true, e.g. PayPal) keep their original colours unless `customColor`
 * (a colour the builder picked for this icon) is given; then they are recoloured like the rest. */
export function smartIconPaint(id,color,customColor){
 const icon=icons.find(item=>item.id===id);
 // The Spinner icon turns (keyframes smart-spin in the Smart stylesheets), wherever it is used.
 const spin=id==="spinner"?{animation:"smart-spin .9s linear infinite"}:{};
 const url="/smart-icons/"+(icon?.file||id+".svg");
 if(icon?.colored&&!customColor)return {backgroundImage:"url("+url+")",backgroundSize:"contain",
  backgroundRepeat:"no-repeat",backgroundPosition:"center",backgroundColor:"transparent"};
 return {backgroundColor:customColor||color,WebkitMaskImage:"url("+url+")",maskImage:"url("+url+")",
  WebkitMaskSize:"contain",maskSize:"contain",WebkitMaskRepeat:"no-repeat",maskRepeat:"no-repeat",
  WebkitMaskPosition:"center",maskPosition:"center",...spin};
}
