import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Alert,KeyboardAvoidingView,Modal,Platform,Pressable,
 ScrollView,Switch,Text,TextInput,View} from 'react-native';
import {useRouter} from 'expo-router';
import {useMobileSession} from './MobileSessionProvider';
import {useMobileTheme,displayValue} from './mobileTheme';
import {MobileButton,MobileMessages} from './MobileUI';
import {fieldType,fieldValueForEditor,findLookupRecords,loadLiveRecord,loadRecordForm,
 safeField,saveLiveRecord,serializeChangedFields,type RecordFormField,type RecordFormObject,type NativeRecord} from './recordFormApi';

type Mode='create'|'edit';
const addressKeys=[['street','Street'],['city','City'],['state','State / county'],
 ['postalCode','Postcode'],['country','Country']] as const;
const isTrue=(v:unknown)=>v===true||v==='true';
const labelFor=(r:NativeRecord)=>String(r.Name??r.Subject??r.Title??r.Id);

export default function NativeRecordForm({objectApi,mode,recordId}:{
 objectApi:string;mode:Mode;recordId?:string;
}){
 const {session,connection,initializing}=useMobileSession(),t=useMobileTheme(),router=useRouter();
 const [schema,setSchema]=useState<RecordFormObject|null>(null);
 const [values,setValues]=useState<Record<string,unknown>>({});
 const [changed,setChanged]=useState<Set<string>>(new Set());
 const [modified,setModified]=useState('');
 const [recordTypeId,setRecordTypeId]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [picker,setPicker]=useState<RecordFormField|null>(null);
 const [query,setQuery]=useState('');
 const scrollRef=useRef<ScrollView>(null),searchSeq=useRef(0);
 const [choices,setChoices]=useState<NativeRecord[]>([]);
 const [choiceLoading,setChoiceLoading]=useState(false);
 const editable=useMemo(()=>schema?.fields.filter(field=>safeField(field,mode))??[],[schema,mode]);
 const fetchForm=useCallback(async()=>{
  if(!session||connection!=='online')return;
  setLoading(true);setError('');
  try{
   const metadata=await loadRecordForm(session,objectApi);
   if(!(mode==='create'?metadata.canCreate:metadata.canEdit))throw new Error('Record access is not permitted.');
   const live=mode==='edit'&&recordId?await loadLiveRecord(session,objectApi,recordId):null;
   const initial:Record<string,unknown>={};
   for(const field of metadata.fields){
    if(!safeField(field,mode))continue;
    const raw=live?live[field.apiName]:field.defaultValue;
    initial[field.apiName]=fieldValueForEditor(field,raw);
   }
   setSchema(metadata);setValues(initial);setChanged(new Set());
   setRecordTypeId(String(live?.RecordTypeId??metadata.recordTypes?.find(x=>x.isDefault)?.id??
     (metadata.recordTypes?.length===1?metadata.recordTypes[0].id:'')));
   setModified(String(live?.LastModifiedDate??''));
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  finally{setLoading(false);}
 },[session,connection,objectApi,recordId,mode]);
 useEffect(()=>{void fetchForm();},[fetchForm]);
 // Errors render above the fields while Save sits below them; bring the message into view.
 useEffect(()=>{if(error)scrollRef.current?.scrollTo({y:0,animated:true});},[error]);
 const confirmCancel=()=>{
  if(changed.size===0){router.back();return;}
  Alert.alert('Discard changes?','Your edits to this record have not been saved.',[
   {text:'Keep editing',style:'cancel'},
   {text:'Discard',style:'destructive',onPress:()=>router.back()}]);
 };
 const patch=(name:string,value:unknown)=>{
  const dependents=editable.filter(field=>field.controllerFieldApiName===name);
  setValues(current=>{
   const next={...current,[name]:value};
   for(const dependent of dependents)next[dependent.apiName]='';
   return next;
  });
  setChanged(current=>new Set([...current,name,...dependents.map(field=>field.apiName)]));
  setError('');
 };
 const save=async()=>{
  if(!session||!schema||connection!=='online'||busy)return;
  setError('');setNotice('');
  let payload:Record<string,unknown>;
  try{payload=serializeChangedFields(editable,values,changed,mode);}
  catch(cause){setError(cause instanceof Error?cause.message:String(cause));return;}
  setBusy(true);
  try{
   const id=await saveLiveRecord(session,objectApi,mode,
     mode==='create'&&recordTypeId?{...payload,RecordTypeId:recordTypeId}:payload,recordId,modified);
   Alert.alert('Saved','The record was saved. Pull down on Records to refresh your offline copy.',[
    {text:'View record',onPress:()=>router.replace({pathname:'/record/[objectApi]/[recordId]',
      params:{objectApi,recordId:id}})}
   ]);
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));
   setNotice('Your draft is preserved. If the record changed elsewhere, close and reload before saving.');
  }finally{setBusy(false);}
 };
 const openPicker=(field:RecordFormField)=>{
  setPicker(field);setQuery('');setChoices([]);
 };
 const searchLookup=async()=>{
  if(!session||!picker?.relationship?.targetObject||connection!=='online')return;
  const seq=++searchSeq.current; // ignore responses that arrive after a newer search
  setChoiceLoading(true);setError('');
  try{
   const rows=await findLookupRecords(session,picker.relationship.targetObject,query);
   if(seq===searchSeq.current)setChoices(rows);
  }
  catch(cause){if(seq===searchSeq.current)setError(cause instanceof Error?cause.message:String(cause));}
  finally{if(seq===searchSeq.current)setChoiceLoading(false);}
 };
 // Search as the user types (debounced); the Search button remains for short or empty terms.
 useEffect(()=>{
  if(!picker||fieldType(picker)!=='reference'||query.trim().length<2)return;
  const timer=setTimeout(()=>{void searchLookup();},350);
  return()=>clearTimeout(timer);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[query,picker]);
 const optionsFor=(field:RecordFormField)=>{
  const all=Array.isArray(field.picklistValues)?field.picklistValues.map(String).filter(Boolean):[];
  const controller=field.controllerFieldApiName;
  if(!controller||!field.valueSettings)return all;
  const allowed=field.valueSettings[String(values[controller]??'')];
  return Array.isArray(allowed)?all.filter(v=>allowed.includes(v)):[];
 };
 const textInput=(field:RecordFormField,value:unknown,subKey?:string)=>{
  const type=fieldType(field),input=displayValue(value);
  const number=['number','currency','percent','geolocation'].includes(type);
  const isMulti=['textarea','longtext','richtext'].includes(type)||subKey==='street';
  return <TextInput accessibilityLabel={field.label+(subKey?' '+subKey:'')}
   style={{minHeight:isMulti?92:50,padding:12,paddingTop:isMulti?12:12,borderRadius:10,
    borderWidth:1,borderColor:t.separator,color:t.text,backgroundColor:t.surface,
    fontSize:16,textAlignVertical:isMulti?'top':'center'}}
   multiline={isMulti}
   keyboardType={number?'decimal-pad':type==='email'?'email-address':
    type==='phone'?'phone-pad':type==='url'?'url':'default'}
   secureTextEntry={type==='encryptedtext'}
   autoCapitalize={type==='email'||type==='url'?'none':'sentences'}
   placeholder={type==='date'?'YYYY-MM-DD':type==='datetime'?'YYYY-MM-DDTHH:MM:SSZ':
    type==='time'?'HH:MM:SS':subKey??field.label}
   placeholderTextColor={t.secondary}
   value={input}
   onChangeText={text=>subKey?patch(field.apiName,{...((values[field.apiName] as object)||{}),[subKey]:text}):
    patch(field.apiName,text)}
  />;
 };
 const renderField=(field:RecordFormField)=>{
  const type=fieldType(field),value=values[field.apiName];
  if(type==='boolean')return <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:54}}>
    <Text style={{fontSize:16,color:t.text,flex:1}}>{field.label}</Text>
    <Switch accessibilityLabel={field.label} value={isTrue(value)} onValueChange={next=>patch(field.apiName,next)} />
  </View>;
  if(type==='address')return <View style={{gap:9}}>
    {addressKeys.map(([key,label])=><View key={key} style={{gap:4}}>
      <Text style={{fontSize:13,color:t.secondary}}>{label}</Text>
      {textInput(field,(value as Record<string,unknown>|null)?.[key]??'',key)}
    </View>)}
  </View>;
  if(type==='geolocation')return <View style={{gap:9}}>
    {(['latitude','longitude'] as const).map(key=><View key={key} style={{gap:4}}>
      <Text style={{fontSize:13,color:t.secondary}}>{key==='latitude'?'Latitude':'Longitude'}</Text>
      {textInput(field,(value as Record<string,unknown>|null)?.[key]??'',key)}
    </View>)}
  </View>;
  if(type==='picklist'||type==='multipicklist'||type==='reference'){
    const isMulti=type==='multipicklist',reference=type==='reference';
    const names=isMulti?String(value??'').split(';').filter(Boolean).join(', '):displayValue(value);
    return <Pressable accessibilityRole="button" accessibilityLabel={'Choose '+field.label}
     onPress={()=>openPicker(field)} style={{minHeight:50,borderRadius:10,borderWidth:1,borderColor:t.separator,
      backgroundColor:t.surface,padding:12,justifyContent:'center'}}>
      <Text style={{fontSize:16,color:names?t.text:t.secondary}}>
       {names|| (reference?'Select a record':isMulti?'Select values':'Select a value')} ▾</Text>
    </Pressable>;
  }
  return textInput(field,value);
 };
 if(initializing||loading)return <View style={{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:t.background}}>
  <ActivityIndicator color={t.accent}/><Text style={{color:t.secondary,marginTop:12}}>Loading record form…</Text></View>;
 return <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}
   style={{flex:1,backgroundColor:t.background}}>
  <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:16,paddingBottom:110,gap:14}}>
   <View style={{gap:5}}>
    <Text style={{fontSize:28,fontWeight:'700',color:t.text}}>{mode==='create'?'New':'Edit'} {schema?.label??objectApi}</Text>
    <Text style={{color:t.secondary,fontSize:14}}>Live server form · Changes are not queued offline</Text>
   </View>
   <MobileMessages error={error} notice={notice}/>
   {connection!=='online'?<Text accessibilityRole="alert" style={{color:t.negative,fontSize:15}}>
     Connect to MetaDrive to create or edit records. Your encrypted offline copy remains read-only.
    </Text>:null}
   {mode==='create'&&schema?.recordTypes&&schema.recordTypes.length>1&&
     <View style={{backgroundColor:t.surface,padding:14,borderRadius:14,gap:10}}>
      <Text style={{fontSize:16,color:t.text,fontWeight:'600'}}>Record type</Text>
      {schema.recordTypes.map(type=><Pressable key={type.id} accessibilityRole="radio"
        accessibilityState={{checked:recordTypeId===type.id}} onPress={()=>setRecordTypeId(type.id)}
        style={{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12}}>
        <Text style={{fontSize:16,color:t.text,flex:1}}>{type.label}</Text>
        <Text style={{color:t.accent,fontSize:20}}>{recordTypeId===type.id?'◉':'○'}</Text>
      </Pressable>)}
     </View>}
   {editable.length===0?<Text style={{color:t.secondary}}>No editable fields are available for this record.</Text>:null}
   {editable.map(field=><View key={field.apiName} style={{padding:14,borderRadius:14,
      backgroundColor:t.surface,gap:9}}>
     {fieldType(field)!=='boolean'&&<Text style={{color:t.text,fontWeight:'600',fontSize:16}}>
       {field.label}{field.required?' *':''}</Text>}
     {renderField(field)}
    </View>)}
   <MobileButton title={busy?'Saving…':mode==='create'?'Create record':'Save changes'}
     disabled={!schema||busy||connection!=='online'||editable.length===0||mode==='edit'&&changed.size===0}
     onPress={()=>void save()}/>
   <MobileButton title="Cancel" secondary onPress={confirmCancel} disabled={busy}/>
  </ScrollView>
  <Modal visible={picker!==null} transparent animationType="slide" onRequestClose={()=>setPicker(null)}>
   <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,.45)'}}>
    <View style={{backgroundColor:t.surface,borderTopLeftRadius:22,borderTopRightRadius:22,
     maxHeight:'84%',paddingTop:16,paddingHorizontal:16,paddingBottom:36,gap:12}}>
     <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',minHeight:44}}>
      <Text style={{fontSize:20,fontWeight:'700',color:t.text,flex:1}}>{picker?.label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close choices" onPress={()=>setPicker(null)} style={{padding:10}}>
       <Text style={{fontSize:17,color:t.accent}}>Done</Text></Pressable>
     </View>
     {picker&&fieldType(picker)==='reference'?<View style={{gap:8}}>
      <TextInput accessibilityLabel="Search matching records" value={query} onChangeText={setQuery}
       placeholder="Search records" placeholderTextColor={t.secondary}
       autoCorrect={false} style={{backgroundColor:t.background,color:t.text,borderRadius:10,padding:14,fontSize:16}}/>
      <MobileButton title={choiceLoading?'Searching…':'Search records'} disabled={choiceLoading}
       onPress={()=>void searchLookup()}/>
     </View>:null}
     <ScrollView keyboardShouldPersistTaps="handled" style={{flexGrow:0}}>
      {picker&&fieldType(picker)==='reference'?choices.map(row=><Pressable key={row.Id}
        accessibilityRole="button" onPress={()=>{patch(picker.apiName,row.Id);setPicker(null);}}
        style={{paddingVertical:15,borderBottomWidth:.5,borderColor:t.separator}}>
       <Text style={{color:t.text,fontSize:16}}>{labelFor(row)}</Text>
      </Pressable>):
       picker?optionsFor(picker).map(value=>{
        const multi=fieldType(picker)==='multipicklist';
        const selected=multi?String(values[picker.apiName]??'').split(';').includes(value):values[picker.apiName]===value;
        return <Pressable key={value} accessibilityRole="button" accessibilityState={{selected}}
         onPress={()=>{
          if(!multi){patch(picker.apiName,value);setPicker(null);return;}
          const set=new Set(String(values[picker.apiName]??'').split(';').filter(Boolean));
          if(set.has(value))set.delete(value);else set.add(value);
          patch(picker.apiName,[...set].join(';'));
         }} style={{paddingVertical:16,borderBottomWidth:.5,borderColor:t.separator,
          flexDirection:'row',justifyContent:'space-between'}}>
         <Text style={{fontSize:16,color:t.text}}>{value}</Text>
         <Text style={{fontSize:16,color:t.accent}}>{selected?'✓':''}</Text>
        </Pressable>;
       }):null}
     </ScrollView>
     <MobileButton title="Clear selection" secondary onPress={()=>{if(picker)patch(picker.apiName,'');setPicker(null);}}/>
    </View>
   </View>
  </Modal>
 </KeyboardAvoidingView>;
}
