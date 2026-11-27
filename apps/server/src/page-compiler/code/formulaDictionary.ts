/**
 * The formula dictionary: every Une formula, defined ONCE, with the code it
 * turns into. The page converter (generateCode.ts) reads only this table, so
 * adding a formula = adding one entry here (and, for a pure function, its plain
 * function in formulaLibrary.ts). A formula missing from this table is a save
 * error ("not in the formula dictionary"), never a run-time interpreter call.
 *
 * Kinds:
 *  - pure:      a plain function F.NAME(...) from formulaLibrary.ts (browser and server).
 *               `clock` functions get the page clock first (NOW, TODAY, HOUR...).
 *  - inline:    becomes JavaScript itself (IF -> ?:, AND -> &&, BLANKVALUE -> ...).
 *  - aggregate: COUNTIFS/SUMIFS...: rows the page holds (browser) or one SQL query (server).
 *  - page:      reads the signed-in session/page (CONNECTED, VERIFYPIN).
 *  - action:    a step of an action formula (button function + server function).
 */
export type FormulaKind='pure'|'inline'|'aggregate'|'page'|'action';
export type FormulaEntry={
 kind:FormulaKind;
 /** Argument count limits (checked at save). */
 min:number;max:number;
 /** pure: the first argument is the page clock ($). */
 clock?:boolean;
 /** inline / page: the JavaScript for already-converted argument code. */
 js?:(args:string[],mode:{async:boolean})=>string;
 /** Runs only on the server (needs the database or secrets). */
 serverOnly?:boolean;
 /** One line shown in the Builder's formula help. */
 help:string;
};

const pure=(min:number,max:number,help:string,clock=false):FormulaEntry=>({kind:'pure',min,max,help,clock});
const action=(min:number,max:number,help:string):FormulaEntry=>({kind:'action',min,max,help});
const aggregate=(help:string,min:number):FormulaEntry=>({kind:'aggregate',min,max:42,help});

/** Code known to give true/false (a comparison, AND, OR, NOT): it needs no O.t(). The set only
 * remembers code text this converter wrote, so the same text always means the same value. */
const BOOLEAN_CODE=new Set<string>();
export function asBoolean(code:string):string{
 if(BOOLEAN_CODE.size>5000)BOOLEAN_CODE.clear();
 BOOLEAN_CODE.add(code);
 return code;
}
export const isBooleanCode=(code:string):boolean=>BOOLEAN_CODE.has(code);
/** Formula truth of generated code: plain when the code is already true/false. */
export const truth=(code:string):string=>BOOLEAN_CODE.has(code)?code:'O.t('+code+')';

export const FORMULA_DICTIONARY:Readonly<Record<string,FormulaEntry>>=Object.freeze({
 /* ---------- Logic: compiled to JavaScript control flow ---------- */
 IF:{kind:'inline',min:2,max:3,help:'IF(test, then, else) -> (test ? then : else)',
  js:a=>'('+truth(a[0])+' ? '+a[1]+' : '+(a[2]??'false')+')'},
 AND:{kind:'inline',min:1,max:20,help:'AND(a, b, ...) -> a && b && ...',
  js:a=>asBoolean('('+a.map(truth).join(' && ')+')')},
 OR:{kind:'inline',min:1,max:20,help:'OR(a, b, ...) -> a || b || ...',
  js:a=>asBoolean('('+a.map(truth).join(' || ')+')')},
 NOT:{kind:'inline',min:1,max:1,help:'NOT(a) -> !a',js:a=>asBoolean('(!'+truth(a[0])+')')},
 BLANKVALUE:{kind:'inline',min:2,max:2,help:'BLANKVALUE(value, fallback): fallback when value is blank',
  js:(a,m)=>'('+(m.async?'await ':'')+'('+(m.async?'async ':'')+'(x) => O.blank(x) ? '+a[1]+' : x)('+a[0]+'))'},
 NULLVALUE:{kind:'inline',min:2,max:2,help:'NULLVALUE(value, fallback): fallback when value is null',
  js:(a,m)=>'('+(m.async?'await ':'')+'('+(m.async?'async ':'')+'(x) => O.nul(x) ? '+a[1]+' : x)('+a[0]+'))'},
 IFERROR:{kind:'inline',min:2,max:2,help:'IFERROR(value, fallback): fallback when value fails',
  js:(a,m)=>m.async?'(await O.tryOrAsync(async () => '+a[0]+', async () => '+a[1]+'))'
   :'O.tryOr(() => '+a[0]+', () => '+a[1]+')'},

 /* ---------- Text ---------- */
 TEXT:pure(1,1,'TEXT(value) -> text'),
 VALUE:pure(1,1,'VALUE(text) -> number'),
 UPPER:pure(1,1,'UPPER(text)'),LOWER:pure(1,1,'LOWER(text)'),PROPER:pure(1,1,'PROPER(text): Title Case'),
 LEN:pure(1,1,'LEN(text): number of characters'),CHAR:pure(1,1,'CHAR(code): CHAR(10) is a new line'),
 LEFT:pure(1,2,'LEFT(text, n)'),RIGHT:pure(1,2,'RIGHT(text, n)'),MID:pure(3,3,'MID(text, start, n)'),
 FIND:pure(2,3,'FIND(find, text, [start]): position or 0'),
 SUBSTITUTE:pure(3,3,'SUBSTITUTE(text, old, new)'),TRIM:pure(1,1,'TRIM(text)'),
 LPAD:pure(2,3,'LPAD(text, length, [pad]): pad on the left, e.g. LPAD(5, 3, "0") = "005"'),
 FORMAT:pure(2,2,'FORMAT(value, pattern): FORMAT(2.5, "0.00") = "2.50", FORMAT(1234, "#,##0") = "1,234", FORMAT(@Invoice.InvoiceDate, "DD/MM/YYYY HH:mm")',true),
 RPAD:pure(2,3,'RPAD(text, length, [pad]): pad on the right'),
 CONTAINS:pure(2,2,'CONTAINS(text, part)'),BEGINS:pure(2,2,'BEGINS(text, start)'),
 CONCAT:pure(1,20,'CONCAT(a, b, ...)'),CONCATENATE:pure(1,20,'CONCATENATE(a, b, ...)'),
 ISPICKVAL:pure(2,2,'ISPICKVAL(picklist, option)'),INCLUDES:pure(2,2,'INCLUDES(multi-picklist, option)'),
 ISNUMBER:pure(1,1,'ISNUMBER(value)'),ISBLANK:pure(1,1,'ISBLANK(value)'),ISNULL:pure(1,1,'ISNULL(value)'),

 /* ---------- Numbers ---------- */
 ROUND:pure(1,2,'ROUND(number, digits)'),ROUNDUP:pure(1,2,'ROUNDUP(number, digits)'),
 ROUNDDOWN:pure(1,2,'ROUNDDOWN(number, digits)'),ABS:pure(1,1,'ABS(number)'),INT:pure(1,1,'INT(number)'),
 FLOOR:pure(1,1,'FLOOR(number)'),CEILING:pure(1,1,'CEILING(number)'),MOD:pure(2,2,'MOD(number, divisor)'),
 MIN:pure(1,20,'MIN(a, b, ...)'),MAX:pure(1,20,'MAX(a, b, ...)'),

 /* ---------- Dates and times (page clock and the user's time zone) ---------- */
 DATE:pure(3,3,'DATE(year, month, day)'),
 DATEVALUE:pure(1,1,'DATEVALUE(text)',true),TODAY:pure(0,0,'TODAY()',true),
 NOW:pure(0,0,'NOW(): date and time to the minute',true),TIMENOW:pure(0,0,'TIMENOW(): time with seconds',true),
 DAY:pure(1,1,'DAY(date)',true),MONTH:pure(1,1,'MONTH(date)',true),YEAR:pure(1,1,'YEAR(date)',true),
 HOUR:pure(1,1,'HOUR(time)',true),MINUTE:pure(1,1,'MINUTE(time)',true),SECOND:pure(1,1,'SECOND(time)',true),
 WEEKDAY:pure(1,1,'WEEKDAY(date): 1 = Sunday',true),TIMEVALUE:pure(1,1,'TIMEVALUE(text)',true),
 ADDDAYS:pure(2,2,'ADDDAYS(date, days)',true),ADDMONTHS:pure(2,2,'ADDMONTHS(date, months)',true),
 GEOLOCATION:pure(2,2,'GEOLOCATION(latitude, longitude)'),DISTANCE:pure(3,3,'DISTANCE(a, b, "km"|"mi")'),

 /* ---------- Collections ---------- */
 COLLECTION:pure(2,20,'COLLECTION(name, item, ...)'),SUM:pure(1,1,'SUM(collection)'),

 /* ---------- Record aggregates: held rows in the browser, one SQL query on the server ---------- */
 COUNTIFS:aggregate('COUNTIFS(Object, Field, value, ...)',3),
 SUMIFS:aggregate('SUMIFS(Object, ValueField, Field, value, ...)',2),
 AVERAGEIFS:aggregate('AVERAGEIFS(Object, ValueField, Field, value, ...)',2),
 MINIFS:aggregate('MINIFS(Object, ValueField, Field, value, ...)',2),
 MAXIFS:aggregate('MAXIFS(Object, ValueField, Field, value, ...)',2),

 /* ---------- Page and session ---------- */
 CONNECTED:{kind:'page',min:1,max:1,help:'CONNECTED("whatsapp"): the connector is installed',
  js:a=>'$.connected('+a[0]+')'},
 VERIFYPIN:{kind:'page',min:1,max:2,serverOnly:true,help:'VERIFYPIN([UserId,] Pin): checked on the server',
  js:(a,m)=>(m.async?'(await ':'(')+'$.verifyPin('+a.join(', ')+'))'},

 /* ---------- Action steps: one button function + one server function ---------- */
 ACTIONS:action(1,64,'ACTIONS(step, step, ...): run steps in order'),
 STATE:action(2,2,'Retired: use @ThisPage.Name.Value = value (the component holds the value)'),
 GETRECORD:action(4,42,'GETRECORD(Object, Field, value, ..., AS(x)) -> x = first matching record'),
 CREATERECORD:action(1,82,'CREATERECORD(Object, Field, value, ...) -> insert in the same transaction'),
 UPDATERECORD:action(4,82,'UPDATERECORD(Object, Id, Field, value, ...) -> update in the same transaction'),
 DELETERECORD:action(2,2,'DELETERECORD(Object, Id) -> delete in the same transaction'),
 FOREACH:action(3,44,'FOREACH(Object, Field, value, ..., AS(x), step) -> for each matching record'),
 SCREEN:action(1,6,'SCREEN(page, [mode], [recordId], [MultiPage, tab id], [seconds]) in any order after the page: open a page; SCREEN(page, MultiPage, n) opens tab n (the tab id, kept when the tab is renamed or moved) of that MultiPage where the page shows (this screen, second screen, customer displays) and never leaves this screen; SCREEN(page, current, MultiPage, n) also opens it here; seconds right after the tab: show it that long, then tab 0'),
 CLOSESCREEN:action(0,1,'CLOSESCREEN(["second"]): close this popup, or the second-monitor screen'),
 INFOSCREEN:action(1,2,'INFOSCREEN(message, [actions after OK]): message box with OK'),
 LOCKSCREEN:action(0,0,'LOCKSCREEN(): lock the till'),
 PAIRDISPLAY:action(1,1,'PAIRDISPLAY(page): pair a screen showing /display (type its 4-digit code); it then shows that page of this app'),
 PAIRGUEST:action(2,2,'PAIRGUEST(app, recordId): pair a tablet showing /display (type its 4-digit code) as that record\'s guest, e.g. a table\'s tablet; it shows the app\'s guest page (App Manager > Guest access)'),
 GUESTLINK:action(3,3,'GUESTLINK(app, recordId, AS(x)): server; the record\'s guest link (x.Url, print it as a QR code). It opens the app\'s guest page with no sign-in (App Manager > Guest access). The old link for the record stops'),
 PRINT:action(2,2,'PRINT(template, recordId)'),CREATEPDF:action(2,3,'CREATEPDF(template, recordId, [AS(x)])'),
 FLOW:action(1,1,'FLOW(name): run a Flow'),
 EMAIL:action(4,24,'EMAIL(credential, to, subject, body, ...)'),WHATSAPP:action(3,23,'WHATSAPP(credential, to, message, ...)'),
 SMS:action(3,3,'SMS(credential, to, message)'),WAIT:action(2,2,'WAIT(minutes, seconds)'),
 LOCATION:action(1,1,'LOCATION(AS(x)): device position'),
 CASHMOVE:action(4,5,'CASHMOVE("IN"|"OUT", Amount, Reason, TillSession, [AS(x)]): cash in/out of the till drawer'),
 CALLOUT:action(1,83,"CALLOUT('Connector.Operation', 'Field', value, ..., AS(x)): server; stops at once when the connector, credential or device is missing"),
 REPEAT:action(2,4,'REPEAT(step, until, [everySeconds], [maxTimes]): server; waits at most 55 seconds in all'),
 AS:action(1,1,'AS(name): name the result of GETRECORD/CREATERECORD/FOREACH')
});

export const formulaEntry=(name:string):FormulaEntry|undefined=>
 Object.prototype.hasOwnProperty.call(FORMULA_DICTIONARY,name)?FORMULA_DICTIONARY[name]:undefined;
export const AGGREGATE_FORMULAS:ReadonlySet<string>=new Set(Object.entries(FORMULA_DICTIONARY)
 .filter(([,entry])=>entry.kind==='aggregate').map(([name])=>name));
