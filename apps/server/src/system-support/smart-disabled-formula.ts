/** "Disable when" formula for Smart Buttons — upgrade-safe, additive SQL metadata.
 * A formula such as  @ThisPage.Total.Value = 0  greys the button out and ignores taps while
 * it is TRUE (Pay / Hold at £0). Blank keeps today's behaviour (always enabled).
 * Actions can still set it directly: @ThisPage.PayCash.Disabled = TRUE. */
type Query={query:(sql:string,params?:unknown[])=>Promise<unknown>};
export const DISABLE_WHEN_COMPONENTS=['smart_button'] as const;
export async function applySmartDisabledFormula(client:Query){
 await client.query(`
  WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT 'disabledFormula','Disable when (formula)','Data','Values','expression',last_order.n+1,
   NULL,'[]'::jsonb,'component',NULL,NULL,true,2,2,150,26,0,'buttons'
  FROM last_order
  ON CONFLICT(property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT c.component_api,'disabledFormula',true,NULL FROM md_builder_ribbon_components c
  WHERE c.component_api=ANY($1::text[])
  ON CONFLICT(component_api,property_key) DO NOTHING`,[[...DISABLE_WHEN_COMPONENTS]]);
}

/** Numpad "Date" input type (DD/MM/YYYY, slashes added while typing) — additive choice. */
export async function applySmartNumpadDateMode(client:Query){
 await client.query(`
  UPDATE md_builder_shared_properties
  SET choices=choices||'["date"]'::jsonb
  WHERE property_key='numpadInputMode' AND jsonb_typeof(choices)='array' AND NOT choices ? 'date'`);
}

/** Smart Cart "Show totals": off turns a cart into a plain list (no Subtotal/VAT/Total box). */
export async function applySmartCartSummaryVisible(client:Query){
 await client.query(`
  WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT 'summaryVisible','Show totals','Design','Summary','boolean',last_order.n+1,
   'true'::jsonb,'[]'::jsonb,'component',NULL,NULL,false,1,1,150,26,0,'buttons'
  FROM last_order
  ON CONFLICT(property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT c.component_api,'summaryVisible',true,NULL FROM md_builder_ribbon_components c
  WHERE c.component_api='smart_cart'
  ON CONFLICT(component_api,property_key) DO NOTHING`);
}

/** Smart Text "Keypad": none / number / decimal / date. A till has no keyboard, so
 * tapping the box opens on-screen keys under it (date types DD/MM/YYYY). */
export async function applySmartTextKeypad(client:Query){
 await client.query(`
  WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT 'keypad','Keypad','Data','Values','choice',last_order.n+1,
   '"none"'::jsonb,'["none","number","decimal","date"]'::jsonb,'component',NULL,NULL,false,3,1,150,26,0,'buttons'
  FROM last_order
  ON CONFLICT(property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT c.component_api,'keypad',true,NULL FROM md_builder_ribbon_components c
  WHERE c.component_api='smart_text'
  ON CONFLICT(component_api,property_key) DO NOTHING`);
}

/** Input box "Field" + "Required". Field links the box to an Object field (Customer.Email):
 * the Object Manager's Required always applies and cannot be switched off here, and the
 * user's field access decides hidden / locked. "Required" can only make a box stricter. */
export const FIELD_RULE_COMPONENTS=['smart_text'] as const;
export async function applySmartInputFieldRules(client:Query){
 for(const [key,label,kind,def,row,order,width] of [
  ['boundField','Field','choice','""',4,1,190],
  ['mandatory','Required','boolean','false',4,2,28]] as const){
  await client.query(`
   WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
   INSERT INTO md_builder_shared_properties
    (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
     min_value,max_value,field_select,design_row,design_order,design_width,design_height,
     design_caption_width,design_display)
   SELECT $1,$2,'Data','Values',$3,last_order.n+1,$4::jsonb,'[]'::jsonb,'component',NULL,NULL,false,$5,$6,$7,26,0,'buttons'
   FROM last_order
   ON CONFLICT(property_key) DO NOTHING`,[key,label,kind,def,row,order,width]);
  await client.query(`
   INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
   SELECT c.component_api,$1,true,NULL FROM md_builder_ribbon_components c
   WHERE c.component_api=ANY($2::text[])
   ON CONFLICT(component_api,property_key) DO NOTHING`,[key,[...FIELD_RULE_COMPONENTS]]);
 }
}

/** Smart Table "Columns": the fields (and named formula columns) to show, in order. */
export async function applySmartTableColumns(client:Query){
 await client.query(`
  WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT 'tableColumns','Columns','Data','Values','expression',last_order.n+1,
   NULL,'[]'::jsonb,'component',NULL,NULL,false,4,1,220,26,0,'buttons'
  FROM last_order
  ON CONFLICT(property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT c.component_api,'tableColumns',true,NULL FROM md_builder_ribbon_components c
  WHERE c.component_api='smart_table'
  ON CONFLICT(component_api,property_key) DO NOTHING`);
 // "Sort": a column name and asc/desc ("InStock asc"); formula columns sort too.
 await client.query(`
  WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT 'tableSort','Sort','Data','Values','expression',last_order.n+1,
   NULL,'[]'::jsonb,'component',NULL,NULL,false,4,2,160,26,0,'buttons'
  FROM last_order
  ON CONFLICT(property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT c.component_api,'tableSort',true,NULL FROM md_builder_ribbon_components c
  WHERE c.component_api='smart_table'
  ON CONFLICT(component_api,property_key) DO NOTHING`);
}

/** Smart Chart "Last N days": one bar per day ending today, £0 on days with no sales. */
export async function applySmartChartDays(client:Query){
 await client.query(`
  WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT 'chartDays','Last N days','Data','Values','number',last_order.n+1,
   '0'::jsonb,'[]'::jsonb,'component',0,60,false,4,3,64,26,0,'buttons'
  FROM last_order
  ON CONFLICT(property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT c.component_api,'chartDays',true,NULL FROM md_builder_ribbon_components c
  WHERE c.component_api='smart_chart'
  ON CONFLICT(component_api,property_key) DO NOTHING`);
}

/** Smart Table "Show record count" (footer). Off for receipts and short lists. */
export async function applySmartTableFooterVisible(client:Query){
 await client.query(`
  WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT 'footerVisible','Show record count','Design','Footer','boolean',last_order.n+1,
   'true'::jsonb,'[]'::jsonb,'component',NULL,NULL,false,1,1,28,26,0,'buttons'
  FROM last_order
  ON CONFLICT(property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT c.component_api,'footerVisible',true,NULL FROM md_builder_ribbon_components c
  WHERE c.component_api='smart_table'
  ON CONFLICT(component_api,property_key) DO NOTHING`);
}

/** Smart Table "Show only" (Column=Value|Value) and the empty-list text. */
export async function applySmartTableShowWhen(client:Query){
 await client.query(`
  WITH last_order AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
  INSERT INTO md_builder_shared_properties
   (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
    min_value,max_value,field_select,design_row,design_order,design_width,design_height,
    design_caption_width,design_display)
  SELECT 'tableShowWhen','Show only','Data','Values','expression',last_order.n+1,
   NULL,'[]'::jsonb,'component',NULL,NULL,false,4,4,200,26,0,'buttons'
  FROM last_order
  ON CONFLICT(property_key) DO NOTHING`);
 await client.query(`
  INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled,default_value_override)
  SELECT c.component_api,k.key,true,NULL FROM md_builder_ribbon_components c
  CROSS JOIN (VALUES ('tableShowWhen'),('emptyText')) AS k(key)
  WHERE c.component_api='smart_table'
   AND EXISTS(SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=k.key)
  ON CONFLICT(component_api,property_key) DO NOTHING`);
}
