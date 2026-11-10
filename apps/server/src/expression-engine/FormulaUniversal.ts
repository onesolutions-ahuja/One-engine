/** Pure formulas are safe to evaluate in any formula editor; they never cause side effects. */
export const UNIVERSAL_FORMULA_FUNCTIONS: ReadonlySet<string> = new Set([
  'IF','IFERROR','AND','OR','NOT','ISBLANK','ISNULL','ISNUMBER',
  'BLANKVALUE','NULLVALUE','TEXT','VALUE','LEN','LOWER','UPPER','PROPER','CHAR',
  'LEFT','RIGHT','FIND','CONTAINS','BEGINS','ISPICKVAL','INCLUDES','ROUND',
  'ROUNDUP','ROUNDDOWN','MIN','MAX','DATE','DATEVALUE','TODAY','NOW',
  'DAY','MONTH','YEAR','HOUR','MINUTE','SECOND','WEEKDAY','ADDDAYS',
  'ADDMONTHS','TIMEVALUE','TIMENOW','GEOLOCATION','DISTANCE','SUM'
]);
