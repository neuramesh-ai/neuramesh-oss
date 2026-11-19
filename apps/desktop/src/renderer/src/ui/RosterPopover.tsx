import {Popover} from './Popover';
import {anchorPoint} from './anchor';
import {IconClose,IconSearch} from './icons';
export function RosterPopover<T extends string>({title,scope,label,query,onQuery,tabs,selected,onSelect,onClose,children,anchor,placeholder='Search by name, role, or specialty…'}:{title:string;scope:string;label?:string;query:string;onQuery:(value:string)=>void;tabs:Array<{id:T;label:string;count:number}>;selected:T;onSelect:(id:T)=>void;onClose:()=>void;children:React.ReactNode;anchor?:{x:number;y:number}|null;placeholder?:string}) {
 return <Popover label={label??`${title} to ${scope}`} anchor={anchor??anchorPoint()} width={460} align="end" onClose={onClose} className="rosterovl aaovl">{dismiss=><>
  <div className="rosterhd"><b>{title}</b><span className="aachan">{scope}</span><button className="rosterx" aria-label="Close access picker" onClick={dismiss}><IconClose s={14}/></button></div>
  <div className="rostersearch"><IconSearch s={15}/><input autoFocus aria-label="Search members" placeholder={placeholder} value={query} onChange={e=>onQuery(e.target.value)}/></div>
  <div className="rosterfilters">{tabs.map(tab=><button key={tab.id} className={`rosterchip aatab${selected===tab.id?' on':''}`} aria-pressed={selected===tab.id} onClick={()=>onSelect(tab.id)}>{tab.label}<span className="aan">{tab.count}</span></button>)}</div>
  {children}
 </>}</Popover>;
}
