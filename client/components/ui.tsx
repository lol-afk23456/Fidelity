import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { ArrowUpRight, Check, LoaderCircle, X, AlertCircle, Inbox, Plus } from 'lucide-react';

export function Button({ children, variant = 'primary', busy, icon, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {variant?: 'primary'|'secondary'|'ghost'|'danger';busy?: boolean;icon?: ReactNode}) {
  return <button {...props} className={`button ${variant} ${props.className || ''}`} disabled={props.disabled || busy}>{busy ? <LoaderCircle size={17} className="spin"/> : icon}{children}</button>;
}
export function Field({ label, hint, children, className='' }: {label:string;hint?:string;children:ReactNode;className?:string}) {
  return <label className={`field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Badge({ children, tone='neutral' }: {children:ReactNode;tone?:string}) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Notice({ children, kind='error' }: {children:ReactNode;kind?:'error'|'success'|'info'}) {return <div className={`notice ${kind}`} role={kind==='error'?'alert':'status'}>{kind==='success'?<Check size={18}/>:<AlertCircle size={18}/>}<span>{children}</span></div>;}
export function Loading({label='Caricamento in corso…'}:{label?:string}) {return <div className="loading" role="status"><LoaderCircle className="spin" size={22}/>{label}</div>;}
export function Empty({title,description,action}:{title:string;description?:string;action?:ReactNode}) {return <div className="empty"><span className="empty-icon"><Inbox size={25}/></span><h3>{title}</h3>{description&&<p>{description}</p>}{action}</div>;}
export function PageHeader({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:ReactNode}) {return <div className="page-heading"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}<span className="title-dot">.</span></h1>{description&&<p>{description}</p>}</div>{action}</div>;}
export function Panel({title,description,action,children,className=''}:{title?:string;description?:string;action?:ReactNode;children:ReactNode;className?:string}) {return <section className={`panel ${className}`}>{(title||action)&&<div className="panel-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</div>}{children}</section>;}
export function Stat({label,value,detail,icon}:{label:string;value:ReactNode;detail?:string;icon?:ReactNode}) {return <div className="stat"><div className="stat-top"><span>{label}</span>{icon}</div><strong>{value}</strong><small>{detail || 'Nel punto vendita selezionato'}</small></div>;}
export function Modal({title,description,onClose,children,wide=false}:{title:string;description?:string;onClose:()=>void;children:ReactNode;wide?:boolean}) {
 const dialog = useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 return <dialog ref={dialog} className={`modal ${wide?'wide':''}`} onCancel={onClose} onClick={event=>{if(event.target===dialog.current)onClose();}}><div className="modal-content"><div className="modal-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Chiudi finestra"><X size={21}/></button></div>{children}</div></dialog>;
}
export function AddButton({children,onClick}:{children:ReactNode;onClick:()=>void}) {return <Button icon={<Plus size={17}/>} onClick={onClick}>{children}</Button>;}
export function ExternalLink({href,children}:{href:string;children:ReactNode}) {return <a className="text-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={16}/></a>;}
export function Money({value}:{value:number}) {return <>{new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(value)}</>;}
export const number = (value: number) => new Intl.NumberFormat('it-IT').format(value || 0);
export const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value)) : '—';
export const dateTime = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : '—';
