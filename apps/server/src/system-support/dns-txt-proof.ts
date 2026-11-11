import {Resolver} from 'node:dns/promises';

/**
 * Shared DNS TXT ownership proof used by tenant custom domains and tenant mail domains.
 *
 * The server's own resolver often caches a negative answer for up to an hour once a
 * record was looked up before it existed (the usual case: the user clicks Verify before
 * the registrar has published the record). We therefore ask the system resolver first and
 * then independent public resolvers, accepting the proof if any of them returns it.
 */
export type DnsTxtProofResult=
  |{status:'match'}
  |{status:'missing'}
  |{status:'mismatch';found:string[]}
  |{status:'unavailable'};

const PUBLIC_RESOLVERS=[['1.1.1.1','1.0.0.1'],['8.8.8.8','8.8.4.4']];
const NOT_FOUND=new Set(['ENOTFOUND','ENODATA','NOTFOUND','NODATA']);

function configuredResolvers():Resolver[]{
  const system=new Resolver({timeout:4000,tries:2});
  const extra=(process.env.METADRIVE_DNS_PROOF_RESOLVERS??'')
    .split(',').map(item=>item.trim()).filter(Boolean);
  const groups=extra.length?[extra]:PUBLIC_RESOLVERS;
  return [system,...groups.map(servers=>{
    const resolver=new Resolver({timeout:4000,tries:2});
    try{resolver.setServers(servers);}catch{/* invalid override: system resolver still applies */}
    return resolver;
  })];
}

export async function checkDnsTxtProof(name:string,expected:string,
  resolvers:Resolver[]=configuredResolvers()):Promise<DnsTxtProofResult>{
  const found=new Set<string>();
  let answered=false;
  for(const resolver of resolvers){
    try{
      const records=await resolver.resolveTxt(name);
      answered=true;
      for(const parts of records){
        // Registrars split long TXT values into 255-byte chunks; some UIs add quotes.
        const value=parts.join('').trim().replace(/^"+|"+$/g,'');
        if(value===expected)return {status:'match'};
        found.add(value);
      }
    }catch(error){
      const code=(error as {code?:string}).code??'';
      if(NOT_FOUND.has(code))answered=true;
      // Timeouts/refusals: try the next resolver.
    }
  }
  if(!answered)return {status:'unavailable'};
  return found.size?{status:'mismatch',found:[...found].slice(0,5)}:{status:'missing'};
}

/** User-facing explanation for a failed proof. Messages start with "DNS " (mapped to HTTP 422). */
export function dnsProofFailureMessage(result:Exclude<DnsTxtProofResult,{status:'match'}>,
  recordName:string,domain:string):string{
  const label=recordName.endsWith('.'+domain)?recordName.slice(0,-domain.length-1):recordName;
  if(result.status==='unavailable')
    return 'DNS lookup failed for '+recordName+'. The DNS servers did not respond; try again in a few minutes.';
  if(result.status==='missing')
    return 'DNS TXT record not found at '+recordName+'. At your DNS provider (e.g. GoDaddy) add a TXT record with '
      +'Name/Host "'+label+'" (not the full domain) and the value shown, then allow up to an hour for it to publish.';
  return 'DNS TXT record at '+recordName+' does not contain the expected value. Found: '
    +result.found.map(value=>'"'+value.slice(0,120)+'"').join(', ')
    +'. Copy the value exactly as shown, with no quotes or spaces.';
}
