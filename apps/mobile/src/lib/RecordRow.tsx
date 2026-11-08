import React from 'react';
import {Pressable,Text,View} from 'react-native';
import {useRouter} from 'expo-router';
import {useMobileTheme,displayValue,recordTitle} from './mobileTheme';
import {useMobileSession,type PhoneRoleMapping} from './MobileSessionProvider';
import type {CachedRecord} from './offlineStore';

const isDisplay=(x:unknown)=>x!==null&&x!==undefined&&typeof x!=='object';
export function mobileRecordFields(item:CachedRecord,roles:PhoneRoleMapping={}){
 const fields=Object.keys(item.record).filter(key=>isDisplay(item.record[key])&&!key.startsWith('_'));
 const byRole=(role:string)=>Object.keys(roles).find(k=>roles[k]===role&&fields.includes(k));
 const excluded=new Set(Object.keys(roles).filter(k=>roles[k]==='hidden'));
 const claimed=new Set<string>();
 const select=(role:'title'|'subtitle'|'badge'|'trailing',fallback?:string)=>{
  const mapped=byRole(role);
  if(mapped&&!claimed.has(mapped)){claimed.add(mapped);return mapped;}
  const next=(fallback&&fields.includes(fallback)&&!claimed.has(fallback)&&!excluded.has(fallback))?fallback:
    fields.find(k=>!claimed.has(k)&&!excluded.has(k));
  if(next)claimed.add(next);
  return next;
 };
 const title=select('title',['Name','Subject','Title'].find(k=>fields.includes(k)));
 return {title,subtitle:select('subtitle'),badge:select('badge'),trailing:select('trailing')};
}
export function RecordRow({item,onSelect,selected=false}:{item:CachedRecord;onSelect?:(item:CachedRecord)=>void;selected?:boolean}){
 const router=useRouter(),theme=useMobileTheme(),{phoneRoles}=useMobileSession();
 const fields=mobileRecordFields(item,phoneRoles[item.objectApi]);
 const text=(key?:string)=>key?displayValue(item.record[key]):'';
 const title=text(fields.title)||recordTitle(item);
 return <Pressable accessibilityRole="button" accessibilityLabel={title+', view record details'}
  onPress={()=>onSelect?onSelect(item):router.push({pathname:'/record/[objectApi]/[recordId]',params:{
    objectApi:item.objectApi,recordId:item.recordId}})}
  style={({pressed})=>({minHeight:68,flexDirection:'row',alignItems:'center',gap:10,
   paddingVertical:10,paddingHorizontal:16,backgroundColor:selected||pressed?theme.badge:theme.surface,
   borderBottomWidth:.5,borderBottomColor:theme.separator})}>
   <View style={{flex:1,minWidth:0,gap:3}}>
    <Text numberOfLines={1} style={{fontSize:17,fontWeight:'600',color:theme.text}}>{title}</Text>
    <Text numberOfLines={1} style={{fontSize:14,color:theme.secondary}}>
      {text(fields.subtitle)||item.objectApi}</Text>
    {fields.badge?<View style={{alignSelf:'flex-start',paddingHorizontal:7,paddingVertical:2,
      borderRadius:6,backgroundColor:theme.badge}}>
      <Text numberOfLines={1} style={{fontSize:12,color:theme.text}}>{text(fields.badge)}</Text>
     </View>:null}
   </View>
   {fields.trailing?<Text numberOfLines={1} style={{maxWidth:95,fontSize:13,color:theme.secondary}}>
      {text(fields.trailing)}</Text>:null}
   <Text style={{color:theme.secondary,fontSize:22}}>›</Text>
 </Pressable>;
}
