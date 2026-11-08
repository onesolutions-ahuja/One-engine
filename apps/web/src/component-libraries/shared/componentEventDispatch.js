/** One logical metadata event => one awaitable action completion.
 * React may ignore a handler's returned promise; attach a noop rejection
 * observer to prevent an unhandled rejection while preserving rejection for
 * explicit awaiters. The Page Runtime owns user-facing error feedback.
 */
export function dispatchComponentEvent(props,event,value){
 let completion;
 try{
  if(event==='change'&&typeof props.onChange==='function'){
   if(props.actionFlows?.change&&typeof props.onAction==='function'){
    // The runtime publishes the input but must not dispatch a second action.
    props.onChange(value,{actionHandled:true});
    completion=props.onAction({event,value});
   }else completion=props.onChange(value);
  }else if(typeof props.onAction==='function')
   completion=props.onAction({event,value});
 }catch(error){
  const rejected=Promise.reject(error);
  void rejected.catch(()=>{});
  return rejected;
 }
 const result=Promise.resolve(completion);
 void result.catch(()=>{});
 return result;
}
