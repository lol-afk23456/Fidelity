import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Tenant,User } from './types';

let csrf='';let tenantHeader='';
export class ApiError extends Error {code:string;status:number;constructor(message:string,code:string,status:number){super(message);this.code=code;this.status=status;}}
export async function api<T=unknown>(path:string,options:RequestInit={}):Promise<T>{
 const headers=new Headers(options.headers);if(options.body && !(options.body instanceof FormData))headers.set('Content-Type','application/json');if(csrf&&options.method&&options.method!=='GET')headers.set('X-CSRF-Token',csrf);if(tenantHeader)headers.set('X-Tenant-Id',tenantHeader);
 const response=await fetch(`/api${path}`,{...options,headers,credentials:'include'});
 if(!response.ok){let detail:{error?:string;code?:string}={};try{detail=await response.json();}catch{/* non-JSON gateway response */}if(response.status===401 && !path.startsWith('/auth'))window.dispatchEvent(new Event('session-expired'));throw new ApiError(typeof detail.error==='string'?detail.error:'La richiesta non è riuscita. Riprova tra qualche istante.',detail.code||'REQUEST_FAILED',response.status);}
 if(response.status===204)return undefined as T;return response.json() as Promise<T>;
}
export const post=<T=unknown>(path:string,data:unknown={})=>api<T>(path,{method:'POST',body:JSON.stringify(data)});
export const patch=<T=unknown>(path:string,data:unknown)=>api<T>(path,{method:'PATCH',body:JSON.stringify(data)});
export const errorText=(error:unknown)=>error instanceof Error?error.message:'Si è verificato un errore inatteso.';
export async function exportMembers(){const headers=new Headers();if(tenantHeader)headers.set('X-Tenant-Id',tenantHeader);const res=await fetch('/api/members/export',{credentials:'include',headers});if(!res.ok){const d=await res.json();throw new Error(d.error||'Esportazione non riuscita.');}const blob=await res.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`clienti-fidelity-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
type Session={user:User;csrfToken:string};
type AuthContextValue={user:User|null;loading:boolean;error:string;demo:boolean;tenants:Tenant[];tenant:Tenant|null;tenantId:string;selectTenant:(id:string)=>void;reloadTenants:()=>Promise<void>;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>};
const AuthContext=createContext<AuthContextValue>(null!);
export function AuthProvider({children}:{children:ReactNode}){
 const [user,setUser]=useState<User|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [demo,setDemo]=useState(false);const [tenants,setTenants]=useState<Tenant[]>([]);const [tenantId,setTenantId]=useState('');
 const selectTenant=useCallback((id:string)=>{tenantHeader=id;setTenantId(id);},[]);
 const reloadTenants=useCallback(async()=>{const result=await api<{items:Tenant[]}>('/tenants');setTenants(result.items);setTenantId(previous=>{const next=result.items.some(t=>t.id===previous)?previous:result.items.find(t=>t.active)?.id||result.items[0]?.id||'';tenantHeader=next;return next;});},[]);
 const acceptSession=useCallback(async(session:Session)=>{csrf=session.csrfToken;await reloadTenants();setUser(session.user);},[reloadTenants]);
 useEffect(()=>{let current=true;void api<{demo:boolean}>('/health').then(result=>{if(current)setDemo(result.demo);}).catch(()=>{});void api<Session>('/auth/me').then(async result=>{if(current)await acceptSession(result);}).catch(err=>{if(current&&(!(err instanceof ApiError)||err.status!==401))setError(errorText(err));}).finally(()=>{if(current)setLoading(false);});const expired=()=>{setUser(null);csrf='';tenantHeader='';setTenants([]);setTenantId('');};window.addEventListener('session-expired',expired);return()=>{current=false;window.removeEventListener('session-expired',expired);};},[acceptSession]);
 const login=async(email:string,password:string)=>{const result=await post<Session>('/auth/login',{email,password});await acceptSession(result);setError('');};
 const logout=async()=>{await post('/auth/logout');setUser(null);setTenants([]);setTenantId('');csrf='';tenantHeader='';};
 return <AuthContext.Provider value={{user,loading,error,demo,tenants,tenant:tenants.find(t=>t.id===tenantId)||null,tenantId,selectTenant,reloadTenants,login,logout}}>{children}</AuthContext.Provider>;
}
export const useAuth=()=>useContext(AuthContext);
export function useResource<T>(path:string|null){
 const {tenantId}=useAuth();const [data,setData]=useState<T|null>(null);const [loading,setLoading]=useState(Boolean(path));const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 const refresh=useCallback(()=>setRevision(n=>n+1),[]);
 useEffect(()=>{let current=true;if(!path){setData(null);setLoading(false);setError('');return;}setLoading(true);setError('');setData(null);api<T>(path).then(result=>{if(current)setData(result);}).catch(err=>{if(current)setError(errorText(err));}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[path,tenantId,revision]);
 return {data,loading,error,refresh};
}
