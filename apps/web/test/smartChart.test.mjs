import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chartSettings,chartNumber,chartPoints,formatChartValue,chartAxisMax,donutSegments,DEFAULT_CHART_COLOURS}
 from '../src/component-libraries/smart_chart/chartData.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Smart Chart settings default safely and clamp builder values',()=>{
 const base=chartSettings({});
 assert.equal(base.type,'bar');
 assert.equal(base.sort,'none');
 assert.equal(base.maxItems,12);
 assert.equal(base.showValues,true);
 assert.equal(base.showGrid,true);
 assert.equal(base.showLegend,false);
 assert.deepEqual(base.colours,DEFAULT_CHART_COLOURS);
 assert.equal(chartSettings({chartType:'pie'}).type,'bar');
 assert.equal(chartSettings({chartType:'donut'}).showGrid,false);
 assert.equal(chartSettings({chartType:'donut'}).showLegend,true);
 assert.equal(chartSettings({chartMaxItems:500}).maxItems,50);
 assert.equal(chartSettings({chartMaxItems:0}).maxItems,1);
 assert.equal(chartSettings({chartShowValues:'false'}).showValues,false);
 assert.equal(chartSettings({chartColor2:'#123456'}).colours[1],'#123456');
});

test('Smart Chart reads numbers from formula text and currency',()=>{
 assert.equal(chartNumber(12.5),12.5);
 assert.equal(chartNumber('£1,240.50'),1240.5);
 assert.equal(chartNumber(''),0);
 assert.equal(chartNumber(null),0);
 assert.equal(chartNumber('n/a'),0);
 assert.equal(chartNumber(true),1);
});

test('Smart Chart groups rows by label, sums values, sorts and limits',()=>{
 const rows=[{c:'Wine',v:10},{c:'Beer',v:'£5'},{c:'Wine',v:2.5},{c:'',v:1},{c:'Spirits',v:30}];
 const points=chartPoints(rows,r=>r.c,r=>r.v,chartSettings({chartSort:'desc',chartMaxItems:3}));
 assert.deepEqual(points.map(p=>[p.label,p.value]),[['Spirits',30],['Wine',12.5],['Beer',5]]);
 assert.ok(points.every(p=>p.colour===DEFAULT_CHART_COLOURS[0]));
 const donut=chartPoints(rows,r=>r.c,r=>r.v,chartSettings({chartType:'donut'}));
 assert.deepEqual(donut.map(p=>p.label),['Wine','Beer','(blank)','Spirits']);
 assert.equal(donut[1].colour,DEFAULT_CHART_COLOURS[1]);
 assert.deepEqual(chartPoints(null,r=>r,r=>r,chartSettings({})),[]);
});

test('Smart Chart formats values and picks a readable axis',()=>{
 assert.equal(formatChartValue(1240,chartSettings({chartValuePrefix:'£'})),'£1,240');
 assert.equal(formatChartValue(2.5,chartSettings({chartDecimals:2})),'2.50');
 assert.equal(chartAxisMax([{value:0}]),1);
 assert.equal(chartAxisMax([{value:420}]),500);
 assert.equal(chartAxisMax([{value:1480}]),2000);
 assert.equal(chartAxisMax([{value:9}]),10);
 const parts=donutSegments([{label:'Card',value:78},{label:'Cash',value:22}]);
 assert.equal(parts[0].share,0.78);
 assert.equal(parts[1].start,0.78);
 assert.deepEqual(donutSegments([{label:'x',value:0}]),[]);
});

test('Smart Chart is registered as a metadata-driven Smart component',()=>{
 const manifest=JSON.parse(read('../src/component-libraries/manifest.json'));
 assert.ok(manifest.components.includes('smart_chart/component.json'));
 const descriptor=JSON.parse(read('../src/component-libraries/smart_chart/component.json'));
 assert.equal(descriptor.apiName,'smart_chart');
 assert.deepEqual(descriptor.propertyDefinitions,[]);
 const seeder=read('../../server/src/app-seeders/smart-components.ts');
 assert.match(seeder,/"smart_chart"/);
 const sql=read('../../server/src/system-support/smart-chart.ts');
 for(const key of ['chartType','chartSort','chartMaxItems','chartShowValues','chartValuePrefix'])
  assert.match(sql,new RegExp("'"+key+"'"));
 assert.match(sql,/'chartColor'\+\(i\+1\)/);
 assert.match(read('../../server/src/system-support/system-migrations.ts'),/await applySmartChart\(client\)/);
});
