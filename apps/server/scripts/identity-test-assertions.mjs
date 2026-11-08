// Synthetic authenticator and signed TEST-ONLY IdP assertions for isolated SQL tests.
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {encodeCBOR} from '@levischuck/tiny-cbor';
import {SignedXml} from 'xml-crypto';
const digest=v=>createHash('sha256').update(v).digest();
const b64=v=>Buffer.from(v).toString('base64url');
export function syntheticPasskey(){
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32);
 const cose=encodeCBOR(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
 const client=(type,challenge,origin)=>Buffer.from(JSON.stringify({type,challenge,origin}));
 return {
  register(options,origin){
   const length=Buffer.alloc(2);length.writeUInt16BE(id.length);
   const authData=Buffer.concat([digest(options.rp.id),Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),length,id,Buffer.from(cose)]);
   const attestation=encodeCBOR(new Map([['fmt','none'],['authData',new Uint8Array(authData)],['attStmt',new Map()]]));
   return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client('webauthn.create',options.challenge,origin)),attestationObject:b64(attestation),transports:['internal']}};
  },
  authenticate(options,origin,counter=1){
   const count=Buffer.alloc(4);count.writeUInt32BE(counter);
   const data=client('webauthn.get',options.challenge,origin),authData=Buffer.concat([digest(options.rpId),Buffer.from([0x05]),count]);
   const signature=sign('sha256',Buffer.concat([authData,digest(data)]),privateKey);
   return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(data),authenticatorData:b64(authData),signature:b64(signature),userHandle:null}};
  }
 };
}
export const testIdpCertificate=()=>readFileSync(new URL('../test/fixtures/security/idp.test.cert.pem',import.meta.url),'utf8');
export function signedSamlResponse({issuer,callback,audience,requestId,subject}){
 const key=readFileSync(new URL('../test/fixtures/security/idp.test.key.pem',import.meta.url),'utf8'),cert=testIdpCertificate();
 const instant=new Date().toISOString(),before=new Date(Date.now()-30000).toISOString(),expiry=new Date(Date.now()+120000).toISOString();
 const responseId='_'+randomBytes(16).toString('hex'),assertionId='_'+randomBytes(16).toString('hex');
 let xml=`<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${instant}" Destination="${callback}" InResponseTo="${requestId}">
 <saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
 <saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${instant}"><saml:Issuer>${issuer}</saml:Issuer>
 <saml:Subject><saml:NameID>${subject}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
 <saml:SubjectConfirmationData InResponseTo="${requestId}" Recipient="${callback}" NotOnOrAfter="${expiry}"/></saml:SubjectConfirmation></saml:Subject>
 <saml:Conditions NotBefore="${before}" NotOnOrAfter="${expiry}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>
 <saml:AuthnStatement AuthnInstant="${instant}" SessionIndex="test"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>
 </saml:Assertion></samlp:Response>`;
 for(const name of ['Assertion','Response']){
  const signer=new SignedXml({privateKey:key,publicCert:cert,signatureAlgorithm:'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',canonicalizationAlgorithm:'http://www.w3.org/2001/10/xml-exc-c14n#'});
  signer.addReference({xpath:`//*[local-name(.)='${name}']`,transforms:['http://www.w3.org/2000/09/xmldsig#enveloped-signature','http://www.w3.org/2001/10/xml-exc-c14n#'],digestAlgorithm:'http://www.w3.org/2001/04/xmlenc#sha256'});
  signer.computeSignature(xml,{location:{reference:`//*[local-name(.)='${name}']/*[local-name(.)='Issuer']`,action:'after'}});xml=signer.getSignedXml();
 }
 return Buffer.from(xml).toString('base64');
}
