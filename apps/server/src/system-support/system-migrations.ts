import {createHash} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

/** Recover original migration files from the immutable SQL baseline.
 * The old runner accepted any subset of known versions and ran missing files
 * in filename order. We preserve that behaviour while verifying every receipt
 * against the exact embedded original SQL before permitting a transition.
 */
export function planLegacyMigrationTransition(
 source:string,receipts:ReadonlyArray<{version:string;checksum:string}>
):Array<{name:string;sql:string}> {
 const sections=[...source.matchAll(/^-- BEGIN ORIGINAL MIGRATION ([0-9a-z-]+\.sql)\n([\s\S]*?)^-- END ORIGINAL MIGRATION \1$/gm)]
  .map(match=>({name:match[1],sql:match[2]}));
 const names=sections.map(item=>item.name);
 const beginCount=[...source.matchAll(/^-- BEGIN ORIGINAL MIGRATION /gm)].length;
 const endCount=[...source.matchAll(/^-- END ORIGINAL MIGRATION /gm)].length;
 if(sections.length!==279||beginCount!==279||endCount!==279||
    new Set(names).size!==279||names.some((n,i)=>i>0&&names[i-1]>=n))
  throw Error('Core SQL baseline does not contain exactly 279 ordered, paired original migrations');
 const original=new Map(sections.map(m=>[m.name,m.sql]));
 const applied=new Set<string>();
 // An OCI production receipt from a previously shipped ribbon-normalisation step
 // is not among the 279 archived originals. It is already applied to the DB;
 // preserve its receipt without replaying unknown SQL or removing the checksum.
 // This exception is deliberately exact, not a general ignore-unknown bypass.
 const externalAppliedReceipt='20270123-normalize-builder-ribbon-properties.sql';
 for(const receipt of receipts){
  if(applied.has(receipt.version))throw Error('Duplicate legacy SQL migration receipt: '+receipt.version);
  const sql=original.get(receipt.version);
  if(sql===undefined){
   if(receipt.version!==externalAppliedReceipt||!/^[a-f0-9]{64}$/.test(receipt.checksum))
    throw Error('Unknown legacy SQL migration receipt: '+receipt.version);
   // The original SQL was not archived: unlike the 279 originals, its receipt
   // can only be shape-checked here. Never pretend its source was reverified.
   applied.add(receipt.version);
   continue;
  }
  if(createHash('sha256').update(sql).digest('hex')!==receipt.checksum)
   throw Error('SQL system migration changed after application: '+receipt.version);
  applied.add(receipt.version);
 }
 return sections.filter(m=>!applied.has(m.name));
}

/** Versioned, additive SQL system migrations; existing business records are untouched. */
export async function applySystemMigrations(db:SqlPersistence) {
 const folder=fileURLToPath(new URL('./migrations/',import.meta.url));
 const files=readdirSync(folder).filter(name=>/^(?:\d{3}|\d{8})-[a-z0-9-]+\.sql$/.test(name)).sort();
 if(files.length!==1||files[0]!=='20261107-core-baseline.sql')
  throw Error('Exactly one approved Core SQL baseline version is required');
 for(let attempt=0;attempt<4;attempt++){
  try {
   await db.transaction(async client=>{
    let appliedNewMigration=false;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['metadrive:system:migrations']);
  await client.query(`CREATE TABLE IF NOT EXISTS md_system_migrations (
   version text PRIMARY KEY,
   checksum text NOT NULL,
   applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for(const name of files){
   const source=readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8');
   const checksum=createHash('sha256').update(source).digest('hex');
   // Existing production databases can have fewer than 279 receipts: older
   // releases had not shipped every migration. Replay only missing originals
   // in their historic order, retaining their receipts for safe API rollback.
   // Unknown/modified receipts abort before making any SQL changes.
   const prior=await client.query<{version:string;checksum:string}>(
    "SELECT version,checksum FROM md_system_migrations WHERE version LIKE '%.sql'");
   const old=prior.rows.filter(row=>row.version!==name);
   if(old.length){
    const baselineReceipt=prior.rows.find(row=>row.version===name);
    if(baselineReceipt){
     // The complete immutable baseline is already applied. Additional receipts
     // may come from later releases and cannot be classified as legacy input.
     // Verify the baseline checksum, preserve every receipt, and never replay
     // historic DDL on an already-baselined production database.
     if(baselineReceipt.checksum!==checksum)
      throw Error('SQL system migration changed after application: '+name);
     continue;
    }
    // First adoption still strictly validates every legacy receipt and
    // replays only migrations missing from the original baseline archive.
    const missing=planLegacyMigrationTransition(source,old);
    for(const migration of missing){
     await client.query(migration.sql);
     appliedNewMigration=true;
     await client.query('INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)',
      [migration.name,createHash('sha256').update(migration.sql).digest('hex')]);
    }
    // Keep old migration receipts for rollback compatibility. If a later
    // deployment step fails, the previous API has individual migration files
    // and must not replay them against the upgraded database. The baseline
    // receipt is written last, inside the same SQL transaction.
    await client.query('INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)',[name,checksum]);
    continue;
   }

   const existing=await client.query<{checksum:string}>(
    'SELECT checksum FROM md_system_migrations WHERE version=$1',[name]);
   if(existing.rows[0]) {
    if(existing.rows[0].checksum!==checksum)
     throw new Error('SQL system migration changed after application: '+name);
    continue;
   }
   await client.query(source);
   appliedNewMigration=true;
   await client.query('INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)',[name,checksum]);
  }
  // Upgrade-safe global ribbon metadata. Reapplying these idempotent inserts
  // works with the immutable single SQL baseline and already-created tenants.
  await client.query(`
    INSERT INTO md_builder_shared_properties
     (property_key,label,tab,section_group,control_kind,sort_order,
      default_value,min_value,max_value,choices,scope)
    SELECT 'inputRows','Rows','Design2','Others','number',
      COALESCE(MAX(sort_order),0)+1,'1'::jsonb,1,12,'[]'::jsonb,'component'
    FROM md_builder_shared_properties
    ON CONFLICT(property_key) DO NOTHING
  `);
  await client.query(`
    INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
    VALUES('smart_text','inputRows',true)
    ON CONFLICT(component_api,property_key) DO NOTHING
  `);
  await client.query(`
    INSERT INTO md_builder_design2_slots
     (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
    SELECT 'Others',COALESCE(MAX(area_order),0)+1,'extra_inputRows',
      2,1,58,26,'inputRows','inputRows'
    FROM md_builder_design2_slots
    ON CONFLICT(area,slot_key) DO NOTHING
  `);
  await client.query(`
    INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
    VALUES('smart_text','Others','extra_inputRows','inputRows')
    ON CONFLICT(component_api,area,slot_key) DO NOTHING
  `);
  // Usage targets include storage_bytes, which routinely exceed the original
  // 1,000,000,000 ceiling (1 GB). Widen once to the API's own limit; idempotent.
  await client.query(`
    DO $$
    BEGIN
     IF EXISTS (SELECT 1 FROM pg_constraint
       WHERE conrelid='md_tenant_usage_targets'::regclass
         AND conname='md_tenant_usage_targets_target_value_check'
         AND pg_get_constraintdef(oid) LIKE '%1000000000)%') THEN
      ALTER TABLE md_tenant_usage_targets DROP CONSTRAINT md_tenant_usage_targets_target_value_check;
      ALTER TABLE md_tenant_usage_targets ADD CONSTRAINT md_tenant_usage_targets_target_value_check
       CHECK (target_value BETWEEN 1 AND 9007199254740991);
     END IF;
    END $$;
  `);
  // Platform-wide switches managed by platform administrators (relational, audited
  // via md_security_events). Additive and idempotent on every start.
  await client.query(`
    CREATE TABLE IF NOT EXISTS md_platform_feature_flags (
     flag text PRIMARY KEY CHECK (flag IN ('tenant_mail')),
     enabled boolean NOT NULL DEFAULT false,
     updated_by_tenant_id uuid REFERENCES md_tenants(id),
     updated_by_user_id uuid,
     updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Smart Toggle's legacy defaultCheck ribbon setting was retired. Reuse the
  // existing, already-published defaultValue expression instead so Page Builder
  // inventory CSV can set the starting ON/OFF state without a new property.
  // Preserve all tenant instances and do not revive defaultCheck.
  await client.query(`
    INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
    SELECT 'smart_toggle','defaultValue',true
    WHERE EXISTS(SELECT 1 FROM md_builder_shared_properties WHERE property_key='defaultValue')
    ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true
  `);

  // New generic Smart Selector; shared properties stay SQL-owned, and this
  // upgrade is safe for databases that already applied the immutable baseline.
  await client.query(`
    INSERT INTO md_builder_ribbon_components(component_api)
    VALUES ('smart_selector') ON CONFLICT(component_api) DO NOTHING
  `);
  await client.query(`
    INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
    SELECT id,'smart_selector','one-bundled:smart_selector',true FROM md_tenants
    ON CONFLICT(tenant_id,api_name) DO NOTHING
  `);
  await client.query(`
    WITH specs(property_key,label,tab_name,group_name,kind,default_json,choices,min_value,max_value,ordinal) AS (
     VALUES
     ('selectorOptionsFormula','Options formula','Data','Values','expression',
      NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,1),
     ('calendarView','View','Design2','Body','choice',
      '"month"'::jsonb,'["month","week","day"]'::jsonb,NULL::integer,NULL::integer,2),
     ('calendarShowEvents','Show events','Design2','Body','boolean',
      'true'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,3),
     ('calendarShowHeader','Show header','Design2','Header','boolean',
      'true'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,4),
     ('calendarShowDateStrip','Date strip','Design2','Header','boolean',
      'true'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,5),
     ('calendarEventColor','Event color','Design2','Focused','color',
      '"#2563eb"'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,6),
     ('calendarBlockedColor','Blocked color','Design2','Focused','color',
      '"#64748b"'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,7),
     ('calendarFreeColor','Unbooked color','Design2','Focused','color',
      '"#f8fbff"'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,8),
     ('calendarStartHour','Start hour','Design2','Others','number',
      '8'::jsonb,'[]'::jsonb,0,23,9),
     ('calendarEndHour','End hour','Design2','Others','number',
      '18'::jsonb,'[]'::jsonb,1,24,10),
     ('calendarSlotMinutes','Slot minutes','Design2','Others','choice',
      '"30"'::jsonb,'["15","30","60"]'::jsonb,NULL::integer,NULL::integer,11),
     ('calendarTimeZone','Time zone','Design2','Others','expression',
      NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,12),
     ('calendarStartSource','Start date/time','Data','Values','expression',
      NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,13),
     ('calendarEndSource','End date/time','Data','Values','expression',
      NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,14),
     ('calendarTitleSource','Event title','Data','Values','expression',
      NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,15),
     ('calendarStatusSource','Event status','Data','Values','expression',
      NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,16)
    ), missing AS (
      SELECT specs.* FROM specs WHERE NOT EXISTS(
        SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=specs.property_key
      )
    ), last_order AS (
      SELECT COALESCE(MAX(sort_order),0) AS sort_order FROM md_builder_shared_properties
    )
    INSERT INTO md_builder_shared_properties
     (property_key,label,tab,section_group,control_kind,sort_order,default_value,
      choices,min_value,max_value,field_select,scope)
    SELECT missing.property_key,missing.label,missing.tab_name,missing.group_name,
     missing.kind,last_order.sort_order+ROW_NUMBER() OVER(ORDER BY missing.ordinal),
     missing.default_json,missing.choices,missing.min_value,missing.max_value,
     missing.tab_name='Data','component'
    FROM missing CROSS JOIN last_order
    ON CONFLICT(property_key) DO NOTHING
  `);
  // Match the Smart Text Body/Data/position property contract, without its
  // multiline-only setting. This does not fork any common property definition.
  await client.query(`
    INSERT INTO md_builder_ribbon_component_rules
      (component_api,property_key,enabled,control_kind_override,value_key,
       default_value_override,choices_override,enabled_when_override)
    SELECT 'smart_selector',r.property_key,r.enabled,r.control_kind_override,r.value_key,
      r.default_value_override,r.choices_override,r.enabled_when_override
    FROM md_builder_ribbon_component_rules r
    WHERE r.component_api='smart_text' AND r.property_key<>'inputRows'
    ON CONFLICT(component_api,property_key) DO NOTHING
  `);
  await client.query(`
    INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
    SELECT 'smart_selector',r.area,r.slot_key,r.property_key
    FROM md_builder_design2_slot_rules r
    WHERE r.component_api='smart_text' AND r.area='Body'
    ON CONFLICT(component_api,area,slot_key) DO NOTHING
  `);
  await client.query(`
    INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
    SELECT v.component_api,v.property_key,true FROM (VALUES
     ('smart_selector','selectorOptionsFormula'),
     ('smart_calendar','calendarView'),('smart_calendar','calendarShowEvents'),
     ('smart_calendar','calendarShowHeader'),('smart_calendar','calendarShowDateStrip'),
     ('smart_calendar','calendarEventColor'),('smart_calendar','calendarBlockedColor'),
     ('smart_calendar','calendarFreeColor'),('smart_calendar','calendarStartHour'),
     ('smart_calendar','calendarEndHour'),('smart_calendar','calendarSlotMinutes'),
     ('smart_calendar','calendarTimeZone'),('smart_calendar','calendarStartSource'),
     ('smart_calendar','calendarEndSource'),('smart_calendar','calendarTitleSource'),
     ('smart_calendar','calendarStatusSource'),
     ('smart_calendar','headerBodyColor'),('smart_calendar','headerTextColor'),
     ('smart_calendar','headerTextSize'),('smart_calendar','headerBorderColor')
    ) AS v(component_api,property_key)
    JOIN md_builder_shared_properties p ON p.property_key=v.property_key
    ON CONFLICT(component_api,property_key) DO NOTHING
  `);
  // Reuse the existing Header and Focused semantic targets for the calendar.
  // Its native 16-control scaffold is untouched, including disabled cells.
  await client.query(`
    INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
    SELECT 'smart_calendar',v.area,v.slot_key,v.property_key FROM (VALUES
     ('Header','fill','headerBodyColor'),('Header','text','headerTextColor'),
     ('Header','size','headerTextSize'),('Header','border','headerBorderColor'),
     ('Focused','fill','defaultValueColor')
    ) AS v(area,slot_key,property_key)
    JOIN md_builder_design2_slots s ON s.area=v.area AND s.slot_key=v.slot_key
    JOIN md_builder_ribbon_component_rules r ON r.component_api='smart_calendar'
      AND r.property_key=v.property_key AND r.enabled=true
    ON CONFLICT(component_api,area,slot_key) DO NOTHING
  `);
  // Stable supplemental rows in existing Body, Header, Focused and Others
  // sections. All selectors render these rows; SQL rules alone enable editors.
  await client.query(`
    WITH specs(area,property_key,ordinal) AS (VALUES
     ('Body','calendarView',1),('Body','calendarShowEvents',2),
     ('Header','calendarShowHeader',3),('Header','calendarShowDateStrip',4),
     ('Focused','calendarEventColor',5),('Focused','calendarBlockedColor',6),
     ('Focused','calendarFreeColor',7),
     ('Others','calendarStartHour',8),('Others','calendarEndHour',9),
     ('Others','calendarSlotMinutes',10),('Others','calendarTimeZone',11),
     ('Others','showDays',12),('Others','firstDay',13)
    )
    INSERT INTO md_builder_design2_slots
      (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
    SELECT spec.area,MIN(slot.area_order),'extra_calendar'||spec.property_key,
      2,100+spec.ordinal,
      CASE WHEN property.control_kind='choice' THEN 110
           WHEN property.control_kind='expression' THEN 160
           WHEN property.control_kind='number' THEN 58 ELSE 40 END,
      26,spec.property_key,spec.property_key
    FROM specs spec JOIN md_builder_design2_slots slot ON slot.area=spec.area
      JOIN md_builder_shared_properties property ON property.property_key=spec.property_key
    GROUP BY spec.area,spec.property_key,spec.ordinal,property.control_kind
    ON CONFLICT(area,slot_key) DO NOTHING
  `);
  await client.query(`
    INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
    SELECT 'smart_calendar',area,slot_key,property_key FROM md_builder_design2_slots
    WHERE slot_key LIKE 'extra_calendar%'
    ON CONFLICT(component_api,area,slot_key) DO NOTHING
  `);
  // Design 2 click-to-style: switch on icons for parts the components already draw.
  // 1) Missing properties, copied from an existing property of the same kind
  //    (same control, limits and icon size). Bold has no default so existing
  //    buttons keep their current weight until a builder picks one.
  await client.query(`
    WITH specs(property_key,label,section_group,template_key,keep_default,ordinal) AS (VALUES
     ('rowBackgroundColor','Row fill','Row','summaryBackgroundColor',false,1),
     ('rowWrapText','Row wrap','Row','footerWrapText',true,2),
     ('summaryWrapText','Summary wrap','Summary','footerWrapText',true,3),
     ('qtyIncreaseTextSize','Plus text size','Button 4','customButton1TextSize',true,4),
     ('qtyIncreaseAlignment','Plus alignment','Button 4','customButton1Alignment',true,5),
     ('qtyIncreaseBold','Plus bold','Button 4','customButton3Bold',false,6),
     ('qtyDecreaseTextSize','Minus text size','Button 5','customButton1TextSize',true,7),
     ('qtyDecreaseAlignment','Minus alignment','Button 5','customButton1Alignment',true,8),
     ('qtyDecreaseBold','Minus bold','Button 5','customButton3Bold',false,9),
     ('customButton1Bold','Custom 1 bold','Button','customButton3Bold',false,10),
     ('customButton2Bold','Custom 2 bold','Button 2','customButton3Bold',false,11),
     ('supportingRadius','Supporting radius','Header Supporting','rowSupportingRadius',true,12),
     ('headerRadius','Header radius','Header','rowSupportingRadius',true,13)
    ), missing AS (
      SELECT specs.* FROM specs WHERE NOT EXISTS(
        SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=specs.property_key)
    ), last_order AS (
      SELECT COALESCE(MAX(sort_order),0) AS sort_order FROM md_builder_shared_properties
    )
    INSERT INTO md_builder_shared_properties
     (property_key,label,tab,section_group,control_kind,sort_order,default_value,min_value,max_value,
      field_select,choices,scope,design_row,design_width,design_height,design_order,design_caption,
      design_caption_width,design_display,enabled_when)
    SELECT m.property_key,m.label,'Design2',m.section_group,t.control_kind,
     last_order.sort_order+ROW_NUMBER() OVER(ORDER BY m.ordinal),
     CASE WHEN m.keep_default THEN t.default_value ELSE NULL END,t.min_value,t.max_value,
     t.field_select,t.choices,t.scope,t.design_row,t.design_width,t.design_height,t.design_order,
     t.design_caption,t.design_caption_width,t.design_display,t.enabled_when
    FROM missing m JOIN md_builder_shared_properties t ON t.property_key=m.template_key
     CROSS JOIN last_order
    ON CONFLICT(property_key) DO NOTHING
  `);
  // 2) Which component uses which property, and on which icon of which area.
  //    Cart/Card Grid/Numpad button areas follow the existing SQL mapping:
  //    Cart Button=Custom 1, Button 2=Custom 2, Button 4=plus, Button 5=minus;
  //    Card Grid Button 3=card button. Only parts the renderer draws are listed.
  await client.query(`
    WITH specs(component_api,area,slot_key,property_key) AS (VALUES
     ('smart_cart','Row','fill','rowBackgroundColor'),('smart_cart','Row','wrap','rowWrapText'),
     ('smart_cart','Summary','wrap','summaryWrapText'),('smart_cart','Header','radius','headerRadius'),
     ('smart_cart','Button','bold','customButton1Bold'),
     ('smart_cart','Button 2','alignment','customButton2Alignment'),('smart_cart','Button 2','size','customButton2TextSize'),
     ('smart_cart','Button 2','bold','customButton2Bold'),
     ('smart_cart','Button 4','alignment','qtyIncreaseAlignment'),('smart_cart','Button 4','size','qtyIncreaseTextSize'),
     ('smart_cart','Button 4','bold','qtyIncreaseBold'),
     ('smart_cart','Button 5','alignment','qtyDecreaseAlignment'),('smart_cart','Button 5','size','qtyDecreaseTextSize'),
     ('smart_cart','Button 5','bold','qtyDecreaseBold'),
     ('smart_cart','Image','border','imageBorderColor'),('smart_cart','Image','fill','imageBackgroundColor'),
     ('smart_table','Row','fill','rowBackgroundColor'),('smart_table','Row','wrap','rowWrapText'),
     ('smart_card_grid','Button','bold','customButton1Bold'),
     ('smart_card_grid','Button 2','alignment','customButton2Alignment'),('smart_card_grid','Button 2','size','customButton2TextSize'),
     ('smart_card_grid','Button 2','bold','customButton2Bold'),
     ('smart_card_grid','Button 3','alignment','cardButtonAlignment'),('smart_card_grid','Button 3','size','cardButtonTextSize'),
     ('smart_card_grid','Button 3','bold','cardButtonBold'),
     ('smart_card_grid','Header Supporting','fill','supportingBackgroundColor'),
     ('smart_card_grid','Header Supporting','border','supportingBorderColor'),
     ('smart_card_grid','Footer','fill','footerBackgroundColor'),('smart_card_grid','Footer','border','footerBorderColor'),
     ('smart_card_grid','Footer','height','footerHeight'),('smart_card_grid','Footer','alignment','footerAlignment'),
     ('smart_numpad','Button 2','bold','customButton1Bold'),('smart_numpad','Button 3','bold','customButton2Bold'),
     ('smart_textbox','Header Supporting','fill','supportingBackgroundColor'),
     ('smart_textbox','Header Supporting','height','supportingBoxHeight'),
     ('smart_textbox','Header Supporting','size','supportingTextSize'),
     ('smart_textbox','Header Supporting','radius','supportingRadius'),
     ('smart_textbox','Header','radius','headerRadius'),
     ('smart_image','Header','fill','headerBodyColor'),('smart_image','Header','text','headerTextColor'),
     ('smart_image','Header','bold','headerBold'),('smart_image','Header','size','headerTextSize'),
     ('smart_image','Image','border','imageBorderColor'),
     ('smart_navigation','Image','border','imageBorderColor'),('smart_navigation','Image','height','imageHeight'),
     ('smart_navigation','Image','width','imageWidth')
    ), usable AS (
      SELECT v.* FROM specs v
      -- The panel draws all 16 icon positions for every area, so no slot row is needed.
      JOIN md_builder_shared_properties p ON p.property_key=v.property_key
      JOIN md_builder_ribbon_components c ON c.component_api=v.component_api
    ), enabled AS (
      INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
      SELECT DISTINCT component_api,property_key,true FROM usable
      ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true
      RETURNING 1
    )
    INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
    SELECT component_api,area,slot_key,property_key FROM usable
    ON CONFLICT(component_api,area,slot_key) DO NOTHING
  `);
  // Navigation icons are 22px; the shared imageHeight default (220) is for cards.
  await client.query(`
    UPDATE md_builder_ribbon_component_rules SET default_value_override='22'::jsonb
    WHERE component_api='smart_navigation' AND property_key IN ('imageHeight','imageWidth')
      AND default_value_override IS NULL
  `);
  // 3) Row fill/wrap and Summary wrap were already mapped to icons, but their
  //    properties did not exist; enable them for the components now that they do.
  await client.query(`
    INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
    SELECT DISTINCT r.component_api,r.property_key,true
    FROM md_builder_design2_slot_rules r
    JOIN md_builder_shared_properties p ON p.property_key=r.property_key
    WHERE r.property_key IN ('rowBackgroundColor','rowWrapText','summaryWrapText')
    ON CONFLICT(component_api,property_key) DO NOTHING
  `);
  // 4) Drag-to-place: which side card buttons, cart row buttons and cart +/-
  //    sit on. Same icon control as imagePlacement, limited to left/right, in
  //    each button area's existing 'placement' icon. Defaults equal the order
  //    the renderer already draws, so existing pages do not move.
  await client.query(`
    WITH specs(property_key,label,section_group,default_side,ordinal) AS (VALUES
     ('cardButtonPlacement','Card button side','Button 3','right',1),
     ('customButton1Placement','Custom 1 side','Button','right',2),
     ('customButton2Placement','Custom 2 side','Button 2','right',3),
     ('qtyIncreasePlacement','Plus side','Button 4','right',4),
     ('qtyDecreasePlacement','Minus side','Button 5','left',5)
    ), missing AS (
      SELECT specs.* FROM specs WHERE NOT EXISTS(
        SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=specs.property_key)
    ), last_order AS (
      SELECT COALESCE(MAX(sort_order),0) AS sort_order FROM md_builder_shared_properties
    )
    INSERT INTO md_builder_shared_properties
     (property_key,label,tab,section_group,control_kind,sort_order,default_value,min_value,max_value,
      field_select,choices,scope,design_row,design_width,design_height,design_order,design_caption,
      design_caption_width,design_display,enabled_when)
    SELECT m.property_key,m.label,'Design2',m.section_group,t.control_kind,
     last_order.sort_order+ROW_NUMBER() OVER(ORDER BY m.ordinal),
     to_jsonb(m.default_side),t.min_value,t.max_value,
     t.field_select,'["left","right"]'::jsonb,t.scope,t.design_row,t.design_width,t.design_height,
     t.design_order,'Side',t.design_caption_width,t.design_display,NULL
    FROM missing m JOIN md_builder_shared_properties t ON t.property_key='imagePlacement'
     CROSS JOIN last_order
    ON CONFLICT(property_key) DO NOTHING
  `);
  await client.query(`
    WITH specs(component_api,area,slot_key,property_key) AS (VALUES
     ('smart_card_grid','Button','placement','customButton1Placement'),
     ('smart_card_grid','Button 2','placement','customButton2Placement'),
     ('smart_card_grid','Button 3','placement','cardButtonPlacement'),
     ('smart_cart','Button','placement','customButton1Placement'),
     ('smart_cart','Button 2','placement','customButton2Placement'),
     ('smart_cart','Button 4','placement','qtyIncreasePlacement'),
     ('smart_cart','Button 5','placement','qtyDecreasePlacement')
    ), usable AS (
      SELECT v.* FROM specs v
      JOIN md_builder_shared_properties p ON p.property_key=v.property_key
      JOIN md_builder_ribbon_components c ON c.component_api=v.component_api
    ), enabled AS (
      INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
      SELECT DISTINCT component_api,property_key,true FROM usable
      ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true
      RETURNING 1
    )
    INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
    SELECT component_api,area,slot_key,property_key FROM usable
    ON CONFLICT(component_api,area,slot_key) DO NOTHING
  `);
  // Cart custom buttons are drawn left to right in the expanded row today.
  await client.query(`
    UPDATE md_builder_ribbon_component_rules SET default_value_override='"left"'::jsonb
    WHERE component_api='smart_cart'
      AND property_key IN ('customButton1Placement','customButton2Placement')
      AND default_value_override IS NULL
  `);
  // 5) Wrap Text where a label could only show on one line ("Check …").
  //    Smart Button reuses wrapText (off by default: buttons stay one line until
  //    switched on); Card Grid's card button reuses cardButtonWrapText; Card Grid
  //    and Cart custom buttons get their own wrap properties (blank = as today).
  await client.query(`
    WITH specs(property_key,label,section_group,ordinal) AS (VALUES
     ('customButton1WrapText','Custom 1 wrap','Button',1),
     ('customButton2WrapText','Custom 2 wrap','Button 2',2)
    ), missing AS (
      SELECT specs.* FROM specs WHERE NOT EXISTS(
        SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=specs.property_key)
    ), last_order AS (
      SELECT COALESCE(MAX(sort_order),0) AS sort_order FROM md_builder_shared_properties
    )
    INSERT INTO md_builder_shared_properties
     (property_key,label,tab,section_group,control_kind,sort_order,default_value,min_value,max_value,
      field_select,choices,scope,design_row,design_width,design_height,design_order,design_caption,
      design_caption_width,design_display,enabled_when)
    SELECT m.property_key,m.label,'Design2',m.section_group,t.control_kind,
     last_order.sort_order+ROW_NUMBER() OVER(ORDER BY m.ordinal),NULL,t.min_value,t.max_value,
     t.field_select,t.choices,t.scope,t.design_row,t.design_width,t.design_height,t.design_order,
     t.design_caption,t.design_caption_width,t.design_display,t.enabled_when
    FROM missing m JOIN md_builder_shared_properties t ON t.property_key='cardButtonWrapText'
     CROSS JOIN last_order
    ON CONFLICT(property_key) DO NOTHING
  `);
  await client.query(`
    WITH specs(component_api,area,slot_key,property_key) AS (VALUES
     ('smart_button','Body','wrap','wrapText'),
     ('smart_card_grid','Button 3','wrap','cardButtonWrapText'),
     ('smart_card_grid','Button','wrap','customButton1WrapText'),
     ('smart_card_grid','Button 2','wrap','customButton2WrapText'),
     ('smart_cart','Button','wrap','customButton1WrapText'),
     ('smart_cart','Button 2','wrap','customButton2WrapText')
    ), usable AS (
      SELECT v.* FROM specs v
      JOIN md_builder_shared_properties p ON p.property_key=v.property_key
      JOIN md_builder_ribbon_components c ON c.component_api=v.component_api
    ), enabled AS (
      INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
      SELECT DISTINCT component_api,property_key,true FROM usable
      ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true
      RETURNING 1
    )
    INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
    SELECT component_api,area,slot_key,property_key FROM usable
    ON CONFLICT(component_api,area,slot_key) DO NOTHING
  `);
  // Existing buttons are single-line; show Wrap Text as off for them.
  await client.query(`
    UPDATE md_builder_ribbon_component_rules SET default_value_override='false'::jsonb
    WHERE component_api='smart_button' AND property_key='wrapText'
      AND default_value_override IS NULL
  `);
  // Tenant developer mailboxes live on the platform-owned mail domain but
  // belong to the new tenant. The baseline's (tenant_id,domain) foreign key
  // made every such insert fail, leaving new tenants suspended without a
  // mailbox. Keep domain integrity with a domain-only key; the tenant mail
  // admin API still only creates mailboxes on domains the caller owns.
  await client.query(`
    DO $$
    DECLARE legacy text;
    BEGIN
     FOR legacy IN
      SELECT c.conname FROM pg_constraint c
      WHERE c.conrelid='md_mail_accounts'::regclass AND c.contype='f'
        AND c.confrelid='md_mail_domains'::regclass AND cardinality(c.conkey)=2
     LOOP
      EXECUTE format('ALTER TABLE md_mail_accounts DROP CONSTRAINT %I',legacy);
     END LOOP;
     IF NOT EXISTS(SELECT 1 FROM pg_constraint
       WHERE conrelid='md_mail_accounts'::regclass AND conname='md_mail_accounts_domain_fkey') THEN
      ALTER TABLE md_mail_accounts ADD CONSTRAINT md_mail_accounts_domain_fkey
       FOREIGN KEY(domain) REFERENCES md_mail_domains(domain);
     END IF;
    END $$;
  `);
  // Cover setup tables introduced by later migrations in the same transaction.
  if(appliedNewMigration)await client.query('SELECT md_install_setup_audit()');
   });
   return;
  } catch(error) {
   // A rolling deploy may overlap with the old instance's SQL work.
   // Retry the entire atomic migration transaction only for PG deadlocks.
   if((error as {code?:string})?.code!=='40P01'||attempt===3)throw error;
   await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
  }
 }

}
