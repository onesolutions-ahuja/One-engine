import {resolvePageActionRoute,type PageActionRoutingContext,type PageActionRoute} from './pageActionRouting';
export function executeOpenPageActionNode(input:{
 binding:Record<string,unknown>;context:PageActionRoutingContext;
 onNavigate:(route:PageActionRoute)=>void;
}):{navigated:true}{
 const destination=resolvePageActionRoute(input.binding,input.context);
 input.onNavigate(destination);
 return {navigated:true};
}
