import {useMemo,useRef,useState} from 'react';
import {modelLabel,type ThinkingLevel} from '@neuramesh/shared';
import {ModelMenu} from '../models/ModelMenu';
import {useCredentialSets} from '../models/hooks';
import {useModelRoster} from '../models/roster';
import {selfUser} from '../lib/self';
import {markOf,chipLabel,providerStates,type ProviderKey} from '../models/picks';
import {ProviderLogo} from '../brain/providers';
import {Popover} from '../ui/Popover';

/** The thread composer's actual catalogue and provider availability, in the same
 * viewport portal used by Finance's access pickers. */
export function FinanceModelPicker({model,thinking,disabled,onPick,onConnect}:{model:string;thinking:ThinkingLevel|null;disabled:boolean;onPick:(model:string,thinking:ThinkingLevel|null)=>void;onConnect:(provider:ProviderKey)=>void}) {
 const {machines,members}=useModelRoster(),{configured}=useCredentialSets();
 const states=useMemo(()=>providerStates(machines,members,selfUser,configured),[machines,members,configured]);
 const button=useRef<HTMLButtonElement>(null);
 const [at,setAt]=useState<{x:number;y:number}|null>(null);
 return <><button ref={button} type="button" className="cchip cmodel finance-model-chip" aria-label={`Finance model: ${chipLabel(modelLabel(model))}`} aria-haspopup="dialog" aria-expanded={!!at} disabled={disabled} onClick={()=>{const r=button.current!.getBoundingClientRect();setAt({x:r.left,y:r.top});}}><ProviderLogo id={markOf(model)} s={13}/><span className="lbl">{chipLabel(modelLabel(model))}</span>{thinking&&<span className="lv">· {thinking}</span>}<span aria-hidden>▾</span></button>
  {at&&<Popover label="Finance model" anchor={at} width={330} onClose={()=>{setAt(null);button.current?.focus();}} className="finance-model-popover"><ModelMenu head={<div className="cprojhint cmodhead"><b>Model</b><span>for Finance</span></div>} current={model} level={thinking} states={states} foot={<>NeuraMesh brain uses workspace credits. Other models use your connected provider.</>} onPick={(m,t)=>{onPick(m,t);setAt(null);button.current?.focus();}} onConnect={provider=>{setAt(null);onConnect(provider);}}/></Popover>}
 </>;
}
