export function mcpOrigin():string|undefined{
 const raw=process.env.METADRIVE_MCP_ORIGIN;
 if(!raw)return undefined;
 const url=new URL(raw);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid METADRIVE_MCP_ORIGIN');
 return url.origin;
}
export function validMcpResource(value:string){return !!mcpOrigin()&&value===mcpOrigin()+'/api/mcp';}
