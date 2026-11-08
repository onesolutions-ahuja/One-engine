/** WAI-ARIA tab keyboard navigation. Call from tab keydown only; the
 * caller updates its own controlled selection and focuses the next button.
 */
export function nextAccessibleTabIndex(
 key:string,index:number,count:number
):number|null{
 if(count<1)return null;
 switch(key){
  case 'ArrowRight':return (index+1)%count;
  case 'ArrowLeft':return (index+count-1)%count;
  case 'Home':return 0;
  case 'End':return count-1;
  default:return null;
 }
}
