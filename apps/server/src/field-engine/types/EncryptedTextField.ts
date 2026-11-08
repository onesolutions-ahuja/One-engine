import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** EncryptedTextField: encryptedtext metadata descriptor. */
export const EncryptedTextDefinition:FieldTypeDefinition=Object.freeze({
 name:'EncryptedTextField',dataType:'encryptedtext',kind:'secure',
 storage:'record'
});

// Existing shared runtime implementation — preserved verbatim.
type OpaqueVault={
  encryptOpaque(value:string):{ciphertext:Buffer;keyId:string};
  decryptOpaque(ciphertext:Buffer,keyId:string):string;
};

const maskedValue='********';
const envelopePrefix='mdenc1';

export function encryptFieldValue(vault:OpaqueVault,tenantId:string,objectApi:string,fieldApi:string,value:string) {
  const encrypted=vault.encryptOpaque(JSON.stringify({tenantId,objectApi,fieldApi,value}));
  return `${envelopePrefix}.${encrypted.keyId}.${encrypted.ciphertext.toString('base64')}`;
}

export function decryptFieldValue(vault:OpaqueVault,tenantId:string,objectApi:string,fieldApi:string,envelope:string) {
  const [version,keyId,encoded,...extra]=envelope.split('.');
  if(version!==envelopePrefix||!keyId||!encoded||extra.length
    ||!/^[A-Za-z0-9_-]{1,80}$/.test(keyId))
    throw new Error('Encrypted field value has an invalid envelope');
  const ciphertext=Buffer.from(encoded,'base64');
  if(ciphertext.length<29||ciphertext.toString('base64')!==encoded)
    throw new Error('Encrypted field value is malformed');
  let payload:unknown;
  try{payload=JSON.parse(vault.decryptOpaque(ciphertext,keyId));}
  catch{throw new Error('Encrypted field value cannot be decrypted');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    throw new Error('Encrypted field payload is invalid');
  const value=payload as Record<string,unknown>;
  if(value.tenantId!==tenantId||value.objectApi!==objectApi||value.fieldApi!==fieldApi
    ||typeof value.value!=='string')
    throw new Error('Encrypted field context does not match its metadata');
  return value.value;
}

export function maskEncryptedFieldValue() {
  return maskedValue;
}
