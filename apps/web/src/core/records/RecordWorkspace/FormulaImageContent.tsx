import {useEffect,useState} from 'react';
import {apiDownload} from '../../authentication/Client/authClient';

type FormulaImageValue={
  __formulaImage:'MetaDriveFormulaImage';
  url:string;
  alt:string;
  height:number|null;
  width:number|null;
};
const fileUrl=/^\/api\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/content$/i;
const imageContentTypes=new Set(['image/jpeg','image/png','image/gif','image/webp']);

export default function FormulaImageContent({value}:{value:FormulaImageValue}) {
  const [objectUrl,setObjectUrl]=useState('');
  const [failed,setFailed]=useState(false);
  const localFile=fileUrl.test(value.url);
  useEffect(()=>{
    if(!localFile)return;
    let active=true;
    let loadedUrl='';
    setObjectUrl('');
    setFailed(false);
    void apiDownload(value.url).then(blob=>{
      if(!imageContentTypes.has(blob.type))throw new Error('Unexpected formula image content type');
      const url=URL.createObjectURL(blob);
      if(!active){URL.revokeObjectURL(url);return;}
      loadedUrl=url;
      setObjectUrl(url);
    }).catch(()=>{
      if(active)setFailed(true);
    });
    return ()=>{
      active=false;
      if(loadedUrl)URL.revokeObjectURL(loadedUrl);
    };
  },[localFile,value.url]);

  if(localFile&&failed)return <span role="img" aria-label="Formula image unavailable">[Image unavailable]</span>;
  let url=value.url;
  if(!localFile){
    try{
      const parsed=new URL(value.url);
      if(parsed.protocol!=='https:'||parsed.username||parsed.password)return null;
      url=parsed.href;
    }catch{return null;}
  }else if(!objectUrl)return null;
  return <img src={localFile?objectUrl:url} alt={value.alt}
    height={value.height??undefined} width={value.width??undefined}
    loading="lazy" referrerPolicy="no-referrer"/>;
}
