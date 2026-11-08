import type {Request,Response,NextFunction} from 'express';
export type Actor={tenant_id:string;user_id:string};
export type AuthenticatedRequest=Request<Record<string,string>>&{actor?:Actor};
export const api=/^[A-Za-z][A-Za-z0-9_]*$/;
export function authenticated(req:AuthenticatedRequest):Actor{
 if(!req.actor?.tenant_id||!req.actor.user_id)throw new Error('Authenticated tenant required');
 return req.actor;
}
export const wrap=(fn:(req:AuthenticatedRequest,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{void fn(req as AuthenticatedRequest,res).catch(next);};
