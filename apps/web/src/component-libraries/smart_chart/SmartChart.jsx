import {chartSettings,chartPoints,formatChartValue,chartAxisMax,donutSegments,CHART_PREVIEW_ROWS}
 from "./chartData.mjs";

/** Smart Chart is presentation-only: records, filters, formulas and permissions
 * come from the shared Page Runtime. Every look-and-feel value is an SQL ribbon
 * property, so builders edit it from the property bar like any Smart component.
 */
const finite=(value,fallback,min,max)=>value!==""&&value!==null&&value!==undefined&&Number.isFinite(Number(value))
 ?Math.max(min,Math.min(max,Number(value))):fallback;
const shadow=value=>value==="large"?"0 8px 20px #0003":
 value==="medium"?"0 3px 9px #0003":value==="small"?"0 1px 4px #0002":"none";
const colour=(value,fallback)=>typeof value==="string"&&value?value:fallback;
const border=value=>value?"1px solid "+value:"1px solid transparent";

function BarChart({points,settings,axisMax,text,barRadius,gap,valueStyle}){
 return <div className="smart-chart-bars" style={{gap}}>
  {points.map(point=><div className="smart-chart-bar-column" key={point.label}>
   <div className="smart-chart-bar-track">
    <div className="smart-chart-bar" title={point.label+": "+formatChartValue(point.value,settings)}
     style={{height:Math.max(0,point.value)/axisMax*100+"%",background:point.colour,
      borderRadius:barRadius+"px "+barRadius+"px 2px 2px"}}/>
    {settings.showValues&&<span className="smart-chart-value"
     style={{...valueStyle,bottom:"calc("+Math.max(0,point.value)/axisMax*100+"% + 4px)"}}>
     {formatChartValue(point.value,settings)}</span>}
   </div>
   <span className="smart-chart-axis-label" style={text}>{point.label}</span>
  </div>)}
 </div>;
}

function HorizontalChart({points,settings,axisMax,text,barRadius,gap,valueStyle}){
 return <div className="smart-chart-rows" style={{gap}}>
  {points.map(point=><div className="smart-chart-row" key={point.label}>
   <span className="smart-chart-row-label" style={text}>{point.label}</span>
   <div className="smart-chart-row-track">
    <div className="smart-chart-row-bar" title={point.label+": "+formatChartValue(point.value,settings)}
     style={{width:Math.max(0,point.value)/axisMax*100+"%",background:point.colour,borderRadius:barRadius}}/>
   </div>
   {settings.showValues&&<span className="smart-chart-row-value" style={valueStyle}>
    {formatChartValue(point.value,settings)}</span>}
  </div>)}
 </div>;
}

function LineChart({points,settings,axisMax,text}){
 const step=points.length>1?100/(points.length-1):0;
 const xy=points.map((point,i)=>[points.length>1?i*step:50,100-Math.max(0,point.value)/axisMax*100]);
 const line=xy.map(([x,y])=>x+","+y).join(" ");
 const stroke=settings.colours[0];
 return <div className="smart-chart-line">
  <svg className="smart-chart-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
   {xy.length>1&&<polygon points={"0,100 "+line+" 100,100"} fill={stroke} opacity="0.12"/>}
   <polyline points={line} fill="none" stroke={stroke} strokeWidth="2.5"
    vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>
  <div className="smart-chart-line-labels">{points.map(point=>
   <span key={point.label} className="smart-chart-axis-label" style={text}
    title={point.label+": "+formatChartValue(point.value,settings)}>{point.label}</span>)}</div>
 </div>;
}

function DonutChart({points,settings,text,valueStyle}){
 const segments=donutSegments(points);
 const total=points.reduce((sum,point)=>sum+Math.max(0,point.value),0);
 const r=15.9155;// circumference = 100, so dash lengths are percentages
 return <div className="smart-chart-donut">
  <div className="smart-chart-donut-ring">
   <svg viewBox="0 0 42 42" aria-hidden="true">
    <circle cx="21" cy="21" r={r} fill="none" stroke="#e5e5ea" strokeWidth="6"/>
    {segments.map(segment=><circle key={segment.label} cx="21" cy="21" r={r} fill="none"
     stroke={segment.colour} strokeWidth="6"
     strokeDasharray={segment.share*100+" "+(100-segment.share*100)}
     strokeDashoffset={25-segment.start*100}/>)}
   </svg>
   {settings.showValues&&<span className="smart-chart-donut-total" style={valueStyle}>
    {formatChartValue(total,settings)}</span>}
  </div>
  {settings.showLegend&&<ul className="smart-chart-legend">{segments.map(segment=>
   <li key={segment.label} style={text}>
    <i style={{background:segment.colour}}/>{segment.label}
    <b>{Math.round(segment.share*100)}%</b>
   </li>)}</ul>}
 </div>;
}

export default function SmartChart({p,records,labelOf,valueOf}){
 const real=Array.isArray(records)?records:[];
 const preview=p.builderPreview===true&&real.length===0;
 const settings=chartSettings(p);
 const points=preview
  ?chartPoints(CHART_PREVIEW_ROWS,row=>row.Label,row=>row.Value,settings)
  :chartPoints(real,labelOf,valueOf,settings);
 const axisMax=chartAxisMax(points);
 const text={color:colour(p.labelColor,"#8e8e93"),fontSize:finite(p.textSize,12,8,48)};
 const valueStyle={color:colour(p.summaryTextColor,"#1d1d1f"),fontSize:finite(p.summaryTextSize,12,8,72),
  fontWeight:p.summaryTextWeight===false?500:600};
 const props={points,settings,axisMax,text,valueStyle,
  barRadius:finite(p.rowRadius,6,0,60),gap:finite(p.gap,10,0,80)};
 const title=typeof p.label==="string"?p.label:"";
 return <section className="smart-chart-root" aria-label={title||"Smart Chart"}
  style={{background:colour(p.backgroundColor,"#ffffff"),border:border(p.borderColor),
   borderRadius:finite(p.radius,16,0,100),boxShadow:shadow(p.shadow)}}>
  {title&&<header className="smart-chart-title" data-design-area={p.builderPreview?"Header":undefined}
   style={{color:colour(p.headerTextColor,"#1d1d1f"),fontSize:finite(p.headerTextSize,15,9,72),
    fontWeight:p.headerBold===false?500:700}}>{title}</header>}
  <div className={"smart-chart-body"+(settings.showGrid&&(settings.type==="bar"||settings.type==="line")
   ?" smart-chart-with-grid":"")} data-design-area={p.builderPreview?"Body":undefined}>
   {settings.showGrid&&(settings.type==="bar"||settings.type==="line")&&
    <div className="smart-chart-grid" aria-hidden="true">{[1,0.5,0].map(f=>
     <div key={f} className="smart-chart-grid-line" style={{bottom:f*100+"%"}}>
      <span style={text}>{formatChartValue(axisMax*f,settings)}</span></div>)}</div>}
   {points.length===0?<p className="smart-chart-empty" style={text}>No data to chart</p>:
    settings.type==="horizontal"?<HorizontalChart {...props}/>:
    settings.type==="line"?<LineChart {...props}/>:
    settings.type==="donut"?<DonutChart {...props}/>:<BarChart {...props}/>}
  </div>
 </section>;
}
