/** Dependency-free QR code encoder (ISO/IEC 18004): byte mode, error correction M,
 * versions 1-40, automatic mask. Returns a square boolean matrix (true = dark). */
const ECC_PER_BLOCK_M=[-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
const BLOCKS_M=[-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];
const FORMAT_M=0;

const rawModules=version=>{
 let result=(16*version+128)*version+64;
 if(version>=2){const align=Math.floor(version/7)+2;result-=(25*align-10)*align-55;if(version>=7)result-=36;}
 return result;
};
const dataCodewords=version=>Math.floor(rawModules(version)/8)-ECC_PER_BLOCK_M[version]*BLOCKS_M[version];
const multiply=(x,y)=>{
 let z=0;
 for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x;}
 return z&0xff;
};
function divisor(degree){
 const result=new Array(degree).fill(0);result[degree-1]=1;
 let root=1;
 for(let i=0;i<degree;i++){
  for(let j=0;j<degree;j++){result[j]=multiply(result[j],root);if(j+1<degree)result[j]^=result[j+1];}
  root=multiply(root,0x02);
 }
 return result;
}
function remainder(data,div){
 const result=new Array(div.length).fill(0);
 for(const b of data){
  const factor=b^result.shift();result.push(0);
  div.forEach((coef,i)=>{result[i]^=multiply(coef,factor);});
 }
 return result;
}
function utf8(text){
 if(typeof TextEncoder!=='undefined')return [...new TextEncoder().encode(text)];
 return [...unescape(encodeURIComponent(text))].map(c=>c.charCodeAt(0));
}

export function encodeQr(text){
 const bytes=utf8(String(text??''));
 let version=1;
 for(;version<=40;version++){
  const countBits=version<=9?8:16;
  if(4+countBits+bytes.length*8<=dataCodewords(version)*8)break;
 }
 if(version>40)throw Error('Text is too long for a QR code');
 const capacity=dataCodewords(version)*8;
 const bits=[];
 const push=(value,length)=>{for(let i=length-1;i>=0;i--)bits.push((value>>>i)&1);};
 push(4,4);push(bytes.length,version<=9?8:16);bytes.forEach(b=>push(b,8));
 push(0,Math.min(4,capacity-bits.length));
 push(0,(8-bits.length%8)%8);
 for(let pad=0xec;bits.length<capacity;pad^=0xec^0x11)push(pad,8);
 const data=[];
 for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>a<<1|b,0));
 // Split into blocks, add Reed-Solomon codewords, interleave.
 const blocks=BLOCKS_M[version],eccLength=ECC_PER_BLOCK_M[version];
 const raw=Math.floor(rawModules(version)/8),shortBlocks=blocks-raw%blocks,shortLength=Math.floor(raw/blocks);
 const div=divisor(eccLength),all=[];
 for(let i=0,k=0;i<blocks;i++){
  const block=data.slice(k,k+shortLength-eccLength+(i<shortBlocks?0:1));
  k+=block.length;
  const ecc=remainder(block,div);
  if(i<shortBlocks)block.push(0);
  all.push(block.concat(ecc));
 }
 const codewords=[];
 for(let i=0;i<all[0].length;i++)all.forEach((block,j)=>{
  if(i!==shortLength-eccLength||j>=shortBlocks)codewords.push(block[i]);
 });
 const size=version*4+17;
 const modules=Array.from({length:size},()=>new Array(size).fill(false));
 const fixed=Array.from({length:size},()=>new Array(size).fill(false));
 const set=(x,y,dark)=>{modules[y][x]=dark;fixed[y][x]=true;};
 for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
 const finder=(cx,cy)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
  const x=cx+dx,y=cy+dy,dist=Math.max(Math.abs(dx),Math.abs(dy));
  if(x>=0&&x<size&&y>=0&&y<size)set(x,y,dist!==2&&dist!==4);
 }};
 finder(3,3);finder(size-4,3);finder(3,size-4);
 const align=[];
 if(version>1){
  const count=Math.floor(version/7)+2;
  const step=version===32?26:Math.ceil((version*4+4)/(count*2-2))*2;
  align.push(6);
  for(let pos=size-7;align.length<count;pos-=step)align.splice(1,0,pos);
 }
 align.forEach((ax,i)=>align.forEach((ay,j)=>{
  if(i===0&&j===0||i===0&&j===align.length-1||i===align.length-1&&j===0)return;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(ax+dx,ay+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
 }));
 const bit=(value,i)=>((value>>>i)&1)!==0;
 const format=mask=>{
  const value=FORMAT_M<<3|mask;
  let rem=value;
  for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);
  const out=(value<<10|rem)^0x5412;
  for(let i=0;i<=5;i++)set(8,i,bit(out,i));
  set(8,7,bit(out,6));set(8,8,bit(out,7));set(7,8,bit(out,8));
  for(let i=9;i<15;i++)set(14-i,8,bit(out,i));
  for(let i=0;i<8;i++)set(size-1-i,8,bit(out,i));
  for(let i=8;i<15;i++)set(8,size-15+i,bit(out,i));
  set(8,size-8,true);
 };
 format(0);
 if(version>=7){
  let rem=version;
  for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>>11)*0x1f25);
  const out=version<<12|rem;
  for(let i=0;i<18;i++){const a=size-11+i%3,b=Math.floor(i/3);set(a,b,bit(out,i));set(b,a,bit(out,i));}
 }
 let index=0;
 for(let right=size-1;right>=1;right-=2){
  if(right===6)right=5;
  for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){
   const x=right-j,upward=((right+1)&2)===0,y=upward?size-1-vert:vert;
   if(!fixed[y][x]&&index<codewords.length*8){modules[y][x]=bit(codewords[index>>>3],7-(index&7));index++;}
  }
 }
 const masks=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,x=>x%3===0,(x,y)=>(x+y)%3===0,
  (x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,(x,y)=>x*y%2+x*y%3===0,
  (x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
 const apply=mask=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!fixed[y][x]&&masks[mask](x,y))modules[y][x]=!modules[y][x];};
 const penalty=()=>{
  let score=0,dark=0;
  for(let a=0;a<size;a++){
   let rowRun=1,colRun=1;
   for(let b=0;b<size;b++){
    if(modules[a][b])dark++;
    if(b>0){
     if(modules[a][b]===modules[a][b-1]){rowRun++;if(rowRun===5)score+=3;else if(rowRun>5)score++;}else rowRun=1;
     if(modules[b][a]===modules[b-1][a]){colRun++;if(colRun===5)score+=3;else if(colRun>5)score++;}else colRun=1;
    }
    if(a>0&&b>0){const c=modules[a][b];if(c===modules[a-1][b]&&c===modules[a][b-1]&&c===modules[a-1][b-1])score+=3;}
   }
  }
  return score+Math.floor(Math.abs(dark*20-size*size*10)/(size*size))*10;
 };
 let best=0,lowest=Infinity;
 for(let mask=0;mask<8;mask++){
  apply(mask);format(mask);
  const score=penalty();
  if(score<lowest){lowest=score;best=mask;}
  apply(mask);
 }
 apply(best);format(best);
 return modules;
}
