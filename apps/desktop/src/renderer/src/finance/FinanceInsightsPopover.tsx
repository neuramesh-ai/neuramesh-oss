import type {FinanceSnapshot} from '@neuramesh/shared';
import {Popover} from '../ui/Popover';
import {IconClose} from '../ui/icons';
import {SpendingInsights} from './FinanceDataViews';
export function FinanceInsightsPopover({snapshot,anchor,onClose,onCategory,onExpand}:{snapshot:FinanceSnapshot|null;anchor:{x:number;y:number};onClose:()=>void;onCategory:(name:string)=>void;onExpand:()=>void}) {
 return <Popover label="Finance insights" anchor={anchor} width={430} align="end" onClose={onClose} className="finance-insights-popover">{dismiss=><><div className="rosterhd"><b>Insights</b><button className="rosterx" aria-label="Close Finance insights" onClick={dismiss}><IconClose s={14}/></button></div><div className="finance-insights-content">{snapshot?<SpendingInsights snapshot={snapshot} onCategory={onCategory}/>:<p>Enable transaction access and refresh Kinshi to see spending insights.</p>}</div><div className="finance-insights-footer"><button className="finance-text-button" onClick={onExpand}>Open full insights ↗</button></div></>}</Popover>;
}
