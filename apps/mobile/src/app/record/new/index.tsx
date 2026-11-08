import React,{useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Pressable,ScrollView,Text,View} from 'react-native';
import {Stack,useRouter,Redirect} from 'expo-router';
import {useMobileSession} from '../../../lib/MobileSessionProvider';
import {useMobileTheme} from '../../../lib/mobileTheme';
import {listEditableObjects,type RecordFormObject} from '../../../lib/recordFormApi';
export default function ChooseObject(){
 const {session,connection,initializing}=useMobileSession(),t=useMobileTheme(),router=useRouter();
 const [objects,setObjects]=useState<RecordFormObject[]>([]);
 const [busy,setBusy]=useState(true),[error,setError]=useState('');
 const load=useCallback(async()=>{
  if(!session||connection!=='online')return;
  setBusy(true);setError('');
  try{setObjects((await listEditableObjects(session)).filter(x=>x.canCreate));}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 },[session,connection]);
 useEffect(()=>{void load();},[load]);
 if(!initializing&&!session)return <Redirect href="/sign-in"/>;
 return <>
  <Stack.Screen options={{title:'New record'}}/>
  <ScrollView style={{backgroundColor:t.background}} contentContainerStyle={{padding:16,gap:12}}>
   <Text style={{fontSize:27,fontWeight:'700',color:t.text}}>Choose record type</Text>
   <Text style={{fontSize:14,color:t.secondary}}>Only objects you are authorised to read and create are shown.</Text>
   {connection!=='online'&&<Text style={{color:t.negative}}>Creating records requires a live connection.</Text>}
   {busy?<ActivityIndicator color={t.accent}/>:null}
   {error?<Text accessibilityRole="alert" style={{color:t.negative}}>{error}</Text>:null}
   {!busy&&!objects.length&&!error?<Text style={{color:t.secondary}}>No available objects. Contact your administrator about create permissions.</Text>:null}
   {objects.map(object=><Pressable key={object.apiName} accessibilityRole="button"
      onPress={()=>router.push({pathname:'/record/new/[objectApi]',params:{objectApi:object.apiName}})}
      style={({pressed})=>({minHeight:60,padding:16,borderRadius:12,
       backgroundColor:pressed?t.badge:t.surface,flexDirection:'row',alignItems:'center',justifyContent:'space-between'})}>
    <Text style={{fontSize:17,fontWeight:'600',color:t.text}}>{object.label}</Text>
    <Text style={{fontSize:20,color:t.secondary}}>›</Text>
   </Pressable>)}
  </ScrollView>
 </>;
}
