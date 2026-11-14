import {createContext,useCallback,useContext,useEffect,useState} from 'react';
import type {Destination,DestinationAccess,DestinationPerson} from '@neuramesh/shared';
import {nm} from '../bridge/nm';
import {AgentAvatar} from '../components/AgentAvatar';
import {RosterPopover} from '../ui/RosterPopover';
import {RosterCluster} from '../ui/RosterCluster';
import './destinations.css';
const Context=createContext<{access:DestinationAccess;reload:()=>Promise<void>}|null>(null);
export const useDestinationAccess=()=>useContext(Context)!;
const nameOf=(destination:Destination)=>destination==='finance'?'Finance':'Marketing';
export function DestinationBoundary({destination,children}:{destination:Destination;children:React.ReactNode}) {
 const [access,setAccess]=useState<DestinationAccess|null>(null),[error,setError]=useState('');
 const reload=useCallback(async()=>{try{setAccess(await nm!.destinationAccess(destination));setError('');}catch(e){setAccess(null);setError(e instanceof Error?e.message:'Access could not be checked.');}},[destination]);
 useEffect(()=>{let live=true;const refresh=()=>{if(live&&!document.hidden)void reload();};void reload();const timer=setInterval(refresh,10000);window.addEventListener('focus',refresh);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refresh);};},[reload]);
 if(!access||access.destination!==destination||!access.canView)return <div className="destination-restricted"><h1>{nameOf(destination)}</h1><p role={error?'alert':'status'}>{error||(access?'Ask the workspace owner to add you to this channel.':'Checking channel access…')}</p>{error&&<button className="btn" onClick={()=>void reload()}>Try again</button>}</div>;
 return <Context.Provider value={{access,reload}}>{children}</Context.Provider>;
}
function Face({person,size=24}:{person:DestinationPerson;size?:number}) {
 return person.kind==='agent'?<AgentAvatar name={person.name} size={size} radius={7}/>:<span className="clutile" style={{width:size,height:size}} aria-hidden>{person.name.trim().charAt(0).toUpperCase()}</span>;
}
export function DestinationRoster() {
 const {access}=useDestinationAccess();
 const [open,setOpen]=useState<{kind:'human'|'agent';anchor:{x:number;y:number}}|null>(null);
 return <div className="destination-roster" aria-label={`${nameOf(access.destination)} access`}>{(['human','agent'] as const).map(kind=>{
  const people=access.people.filter(p=>p.kind===kind&&p.hasAccess),label=kind==='human'?'people':'agents';
  return <RosterCluster key={kind} count={people.length} label={`${people.length} ${label} have access to ${nameOf(access.destination)}`} tip={`${nameOf(access.destination)} ${label}`} onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();setOpen({kind,anchor:{x:rect.right,y:rect.bottom}});}}>{people.slice(0,3).map(person=><Face person={person} size={22} key={person.id}/>)}</RosterCluster>;
 })}{open&&<RosterPicker kind={open.kind} anchor={open.anchor} onClose={()=>setOpen(null)}/>}</div>;
}
function RosterPicker({kind,anchor,onClose}:{kind:'human'|'agent';anchor:{x:number;y:number};onClose:()=>void}) {
 const {access,reload}=useDestinationAccess(),[query,setQuery]=useState(''),[tab,setTab]=useState<'all'|'in'|'out'>('all'),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
 const people=access.people.filter(p=>p.kind===kind),destination=nameOf(access.destination),noun=kind==='agent'?'agents':'people';
 const matches=people.filter(p=>`${p.name} ${p.role} ${p.description??''}`.toLowerCase().includes(query.trim().toLowerCase()));
 const groups:Array<{label:string;rows:DestinationPerson[]}>=[];
 if(access.canManage&&tab!=='in')groups.push({label:`Not in ${destination}`,rows:matches.filter(p=>!p.hasAccess)});
 if(tab!=='out')groups.push({label:'Already here',rows:matches.filter(p=>p.hasAccess)});
 async function change(person:DestinationPerson){setBusy(person.id);setError('');try{await nm!.destinationMember(access.destination,{kind:person.kind,id:person.id,on:!person.hasAccess});await reload();}catch(e){setError(e instanceof Error?e.message:'Access could not be changed.');}finally{setBusy(null);}}
 const tabs=([{id:'all',label:'All',count:people.length},{id:'in',label:`In ${destination}`,count:people.filter(p=>p.hasAccess).length},...(access.canManage?[{id:'out',label:`Not in ${destination}`,count:people.filter(p=>!p.hasAccess).length}]:[])] as Array<{id:'all'|'in'|'out';label:string;count:number}>);
 return <RosterPopover title={`${access.canManage?'Add':'View'} ${noun}`} label={`${access.canManage?'Add':'View'} ${noun} in ${destination}`} scope={destination} query={query} onQuery={setQuery} selected={tab} onSelect={setTab} tabs={tabs} anchor={anchor} onClose={onClose}>
  {error&&<p className="destination-picker-error" role="alert">{error}</p>}
  <div className="rosterlist aalist">{groups.every(group=>!group.rows.length)&&<div className="rosterempty">No matching {noun}.</div>}{groups.filter(group=>group.rows.length).map(group=><div key={group.label}><div className="aagrp">{group.label}</div>{group.rows.map(person=><div className={`aarow${person.hasAccess?' inroom':''}`} key={person.id}><Face person={person} size={30}/><div className="aabody"><span className="aaname"><b>{person.name}</b><span className="rolechip" data-role={person.role}>{person.owner?'Owner':person.role}</span></span><span className="aastat">{person.description||(person.owner?'Workspace owner':kind==='human'?'Workspace member':'Workspace agent')}</span></div>{person.hasAccess?<span className="aain">{access.canManage&&!person.owner&&<button className="aaremove" disabled={busy!==null} onClick={()=>void change(person)}>{busy===person.id?'Saving…':'Remove'}</button>}<span className="aainlbl">✓ Has access</span></span>:<button className="aaadd" disabled={busy!==null} onClick={()=>void change(person)}>{busy===person.id?'Saving…':'+ Add'}</button>}</div>)}</div>)}</div>
  <div className="aafoot destination-access-note">{access.canManage?`Only people and agents added here can access ${destination}. The workspace owner always has access.`:'The workspace owner manages access to this channel.'}</div>
 </RosterPopover>;
}
