import type {LightningPageMetadata} from '../../metadata/Definitions/metadata';

export type PagePerformanceFinding={
  componentId:string;
  label:string;
  category:'data'|'render'|'binding';
  reason:string;
  recommendation:string;
};
/** Source-level analysis only: findings identify concrete configured work,
 * not a fabricated runtime duration or an arbitrary performance score.
 */
export function analyzePagePerformance(page:Pick<LightningPageMetadata,'components'>):PagePerformanceFinding[]{
  const findings:PagePerformanceFinding[]=[];
  const dataTypes=new Set(['Report Chart','Dashboard','Related List','List View','Record List',
    'Screen Flow','Embedded Screen Flow','Related Record']);
  for(const component of page.components){
    if(component.visible===false)continue;
    const properties=component.properties??{};
    const label=component.label||component.type;
    const add=(category:PagePerformanceFinding['category'],reason:string,recommendation:string)=>
      findings.push({componentId:component.id,label,category,reason,recommendation});
    if(dataTypes.has(component.type))
      add('data',component.type+' loads data or services at runtime',
        'Verify authorised server request count, paging and query filters in preview and live runtime.');
    if(typeof properties.pageSize==='number'&&properties.pageSize>100)
      add('data','Configured page size: '+properties.pageSize,
        'Reduce page size and verify server-side pagination covers the complete filtered result set.');
    if(typeof properties.refreshInterval==='number'&&properties.refreshInterval>0&&properties.refreshInterval<30)
      add('data','Refresh interval: '+properties.refreshInterval,
        'Review polling frequency and avoid overlapping requests.');
    if(component.type==='Image'||component.type==='ui_image'){
      const source=properties.src??properties.imageUrl??properties.url;
      if(typeof source==='string'&&source.startsWith('data:')&&source.length>50000)
        add('render','Large inline image payload ('+source.length+' characters)',
          'Use the authorised media library with sized image assets.');
    }
    if(properties.pagePropertyContract&&typeof properties.pagePropertyContract==='object')
      add('binding','Page behaviour conditions or interactions are configured',
        'Measure updates and re-renders when controlling values change.');
  }
  return findings;
}
