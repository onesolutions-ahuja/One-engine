import type {PageStateChoice} from './pageStateChoices';

/** Shared Formula Bar references use the existing runtime contract:
 * @Field = Object data, $state.key = declared page state,
 * $session.id = page session ID, $session.user.* = authenticated identity,
 * $session.tenant.* = authenticated tenant/brand. No credentials exposed.
 */
export type DollarFormulaSuggestion={reference:string;label:string};
export function formulaDollarSuggestions(
 choices:readonly PageStateChoice[],query='',
 // Action formula bar only: $flow.ApiName for each runnable Flow.
 flows?:readonly {apiName:string;label:string}[]
):DollarFormulaSuggestion[]{
 const suggestions:DollarFormulaSuggestion[]=[
  {reference:'$session.id',label:'Current page session ID'},
  {reference:'$session.cartId',label:'Active Cart record ID'},
  {reference:'$session.user.id',label:'Logged-in user ID'},
  {reference:'$session.user.email',label:'Logged-in user email'},
  {reference:'$session.user.name',label:'Logged-in user name'},
  {reference:'$session.user.locale',label:'Logged-in user locale'},
  {reference:'$session.user.timeZone',label:'Logged-in user time zone'},
  {reference:'$session.user.currencyIsoCode',label:'Logged-in user currency'},
  {reference:'$session.tenant.id',label:'Current tenant ID'},
  {reference:'$session.tenant.name',label:'Company name (Company Settings)'},
  {reference:'$session.tenant.logo',label:'Company logo (Company Settings)'}
 ];
 const unique=new Set<string>();
 for(const choice of choices){
  if(choice.source!=='PageState'
   ||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(choice.key)
   ||unique.has(choice.key))continue;
  unique.add(choice.key);
  suggestions.push({reference:'$state.'+choice.key,label:choice.label+' · Page State'});
 }
 for(const flow of flows??[])
  if(/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(flow.apiName))
   suggestions.push({reference:'FLOW('+flow.apiName+')',label:flow.label+' · Flow'});
 const match=query.toLowerCase();
 return suggestions.filter(item=>item.reference.toLowerCase().slice(1).includes(match)
   ||item.label.toLowerCase().includes(match)).slice(0,200);
}
