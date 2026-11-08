import {createHash} from 'node:crypto';
import {gzipSync,brotliCompressSync,constants} from 'node:zlib';

/** Immutable filename; the complete serialized renderer payload determines identity. */
export function rendererFileName(apiName,serialized){
 if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName))throw Error('Invalid bundled API name');
 if(typeof serialized!=='string'||!serialized)throw Error('Missing renderer data');
 return apiName+'.'+createHash('sha256').update(serialized).digest('hex').slice(0,16)+'.json';
}
/** Sidecars are precompressed at build time, not for every browser request. */
export function compressRenderer(serialized){
 return {
  gzip:gzipSync(serialized,{level:6}),
  brotli:brotliCompressSync(serialized,{
   params:{[constants.BROTLI_PARAM_QUALITY]:5}
  })
 };
}
