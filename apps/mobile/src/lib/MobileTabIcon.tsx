import React from 'react';
import {View,type ColorValue} from 'react-native';

export type MobileTabIconName='records'|'search'|'settings';

/** Scalable platform-native View primitives. No icon-font download,
 * Unicode fallbacks or dependency to initialise on the login screen. */
export function MobileTabIcon({name,color,background='transparent',size=23}:{name:MobileTabIconName;color:ColorValue;background?:ColorValue;size?:number}){
 const stroke=Math.max(1.8,size/12);
 const line=(width:number,top:number,left:number)=>({
  position:'absolute' as const,left,top,width,height:stroke,
  backgroundColor:color,borderRadius:stroke
 });
 if(name==='search')return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
  style={{width:size,height:size,position:'relative'}}>
  <View style={{width:size*.55,height:size*.55,borderWidth:stroke,borderColor:color,
   borderRadius:size/2,position:'absolute',top:1,left:1}} />
  <View style={{width:size*.42,height:stroke,borderRadius:stroke,backgroundColor:color,
   position:'absolute',top:size*.69,left:size*.62,transform:[{rotate:'45deg'}]}}/>
 </View>;
 if(name==='settings')return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
  style={{width:size,height:size,position:'relative'}}>
   {[.25,.5,.75].map((fraction,i)=><React.Fragment key={fraction}>
     <View style={line(size*.9,size*fraction,1)} />
     <View style={{position:'absolute',left:size*(i===1 ? .62 : .32)-stroke*1.3,
       top:size*fraction-stroke*1.8,width:stroke*3.6,height:stroke*3.6,
       borderWidth:stroke,borderColor:color,borderRadius:stroke*2,backgroundColor:background}} />
    </React.Fragment>)}
 </View>;
 return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
  style={{width:size,height:size,position:'relative'}}>
   <View style={{position:'absolute',top:1,left:1,right:1,bottom:1,borderWidth:stroke,borderColor:color,
    borderRadius:size*.15}} />
   {[.25,.5,.75].map(fraction=><View key={fraction} style={line(size*.55,size*fraction,size*.23)} />)}
 </View>;
}
