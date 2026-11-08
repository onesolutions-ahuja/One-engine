import {useColorScheme} from 'react-native';

export const palettes={
 light:{background:'#f2f2f7',surface:'#ffffff',text:'#1c1c1e',secondary:'#686870',separator:'#c6c6c8',
  accent:'#007aff',badge:'#e5f1ff',positive:'#1a7c45',negative:'#b42318',danger:'#d70015'},
 dark:{background:'#000000',surface:'#1c1c1e',text:'#f5f5f7',secondary:'#aeaeb2',separator:'#38383a',
  accent:'#0a84ff',badge:'#20354a',positive:'#30d158',negative:'#ff6961',danger:'#ff453a'}
} as const;
export function useMobileTheme(){
 const mode=useColorScheme();
 return mode==='dark'?palettes.dark:palettes.light;
}
export function displayValue(v:unknown):string{
 if(typeof v==='string')return v;
 if(typeof v==='number'||typeof v==='boolean')return String(v);
 if(v===null||v===undefined)return '';
 return JSON.stringify(v);
}
export function recordTitle(item:{objectApi:string;record:Record<string,unknown>}):string{
 const name=item.record.Name??item.record.Subject??item.record.Title;
 return typeof name==='string'&&name.trim()?name:item.objectApi+' record';
}
