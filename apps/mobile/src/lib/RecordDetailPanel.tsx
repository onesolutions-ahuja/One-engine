import React from 'react';
import {Pressable,Text,View} from 'react-native';
import {useMobileTheme,displayValue} from './mobileTheme';

/** Read-only record presentation reused by phone navigation and iPad split view.
 * Authorisation and live edit permissions remain with the owning route.
 */
export function RecordDetailPanel({objectApi,record,labels,syncedAt,live=false,online=true,canEdit=false,onEdit,onOpen}:{
 objectApi:string;
 record:Record<string,unknown>|null;
 /** Optional apiName → display label map; falls back to the API name (e.g. offline cache). */
 labels?:Record<string,string>;
 syncedAt?:string;
 live?:boolean;online?:boolean;canEdit?:boolean;
 onEdit?:()=>void;
 onOpen?:()=>void;
}){
 const t=useMobileTheme();
 if(!record)return <View style={{backgroundColor:t.surface,borderRadius:13,padding:20}}>
  <Text style={{fontSize:16,color:t.secondary}}>Select a record to view its details.</Text>
 </View>;
 const fields=Object.entries(record).filter(([key,val])=>
   !['Id','LastModifiedDate','CreatedAt','OwnerId','RecordTypeId'].includes(key)
   && val!==null && val!==undefined && !key.startsWith('_'));
 const title=String(record.Name??record.Subject??record.Title??objectApi);
 return <View style={{gap:17}}>
  <View style={{gap:6,padding:7}}>
   <Text style={{fontSize:28,fontWeight:'600',color:t.text}}>{title}</Text>
   <Text style={{fontSize:13,color:t.secondary}}>{objectApi} · {live?'Live record':'Offline cached copy'}</Text>
   <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>
    {onOpen&&<Pressable accessibilityRole="button" accessibilityLabel="Open full record"
     onPress={onOpen} style={{alignSelf:'flex-start',minHeight:44,justifyContent:'center',
      paddingHorizontal:16,borderRadius:10,backgroundColor:t.accent}}>
     <Text style={{color:'#fff',fontSize:15,fontWeight:'600'}}>Open record</Text>
    </Pressable>}
    {live&&canEdit&&onEdit&&<Pressable accessibilityRole="button" accessibilityLabel="Edit record"
     onPress={onEdit} style={{alignSelf:'flex-start',minHeight:44,justifyContent:'center',
      paddingHorizontal:16,borderRadius:10,backgroundColor:t.accent}}>
     <Text style={{color:'#fff',fontSize:15,fontWeight:'600'}}>Edit record</Text>
    </Pressable>}
   </View>
  </View>
  <View style={{backgroundColor:t.surface,borderRadius:13,overflow:'hidden'}}>
   {fields.map(([name,value])=><View key={name} style={{flexDirection:'row',
      justifyContent:'space-between',gap:12,paddingVertical:13,paddingHorizontal:15,
      borderBottomWidth:.5,borderBottomColor:t.separator,minHeight:48}}>
    <Text style={{color:t.secondary,fontSize:14,maxWidth:'40%'}}>{labels?.[name]??name}</Text>
    <Text selectable style={{color:t.text,fontSize:15,maxWidth:'58%',textAlign:'right'}}>
     {displayValue(value)}
    </Text>
   </View>)}
  </View>
  {syncedAt&&<Text style={{color:t.secondary,fontSize:13}}>Offline copy last synced {new Date(syncedAt).toLocaleString()}</Text>}
  {!online&&<Text style={{color:t.secondary,fontSize:13}}>Reconnect to edit this record.</Text>}
 </View>;
}
