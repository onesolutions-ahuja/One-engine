import React from 'react';
import {Pressable,Text,View,type StyleProp,type ViewStyle} from 'react-native';
import {useMobileTheme} from './mobileTheme';

export function MobileButton({title,onPress,disabled=false,secondary=false,danger=false,style}:{
 title:string;onPress:()=>void;disabled?:boolean;secondary?:boolean;danger?:boolean;style?:StyleProp<ViewStyle>;
}){
 const t=useMobileTheme();
 return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
  style={({pressed})=>[{
    minHeight:50,alignItems:'center',justifyContent:'center',paddingHorizontal:15,
    borderRadius:12,backgroundColor:secondary?t.surface:danger?t.danger:t.accent,opacity:disabled?.5:pressed?.75:1
   },style]}>
   <Text style={{fontSize:17,fontWeight:'600',color:secondary?t.accent:'#ffffff'}}>{title}</Text>
 </Pressable>;
}
export function ConnectionBadge({online}:{online:boolean}){
 const t=useMobileTheme();
 return <View accessible accessibilityLabel={online?'Online':'Offline'} style={{backgroundColor:t.badge,
  borderRadius:999,paddingVertical:5,paddingHorizontal:10}}>
  <Text style={{fontSize:13,fontWeight:'600',color:online?t.positive:t.secondary}}>{online?'● Online':'○ Offline'}</Text>
 </View>;
}
export function MobileMessages({error,notice}:{error?:string;notice?:string}){
 const t=useMobileTheme();
 return <>{error?<Text accessibilityRole="alert" style={{padding:12,fontSize:14,color:t.negative}}>{error}</Text>:null}
  {notice?<Text accessibilityRole="text" style={{padding:12,fontSize:14,color:t.positive}}>{notice}</Text>:null}</>;
}

/** Persistent offline notice with the age of the cached copy, so users need not open Settings. */
export function OfflineBanner({syncedAt}:{syncedAt?:string}){
 const t=useMobileTheme();
 const when=syncedAt&&!Number.isNaN(new Date(syncedAt).getTime())?new Date(syncedAt).toLocaleString():'';
 return <View accessible accessibilityRole="alert" style={{backgroundColor:t.badge,borderRadius:12,
  paddingVertical:10,paddingHorizontal:14,gap:2}}>
  <Text style={{fontSize:15,fontWeight:'600',color:t.text}}>You are offline</Text>
  <Text style={{fontSize:13,color:t.secondary}}>
   {when?'Showing your offline copy, last synced '+when+'.':'Showing your offline copy. It has not been synced yet.'}</Text>
 </View>;
}
