export function RosterCluster({count,label,tip,onClick,children}:{count:number;label:string;tip:string;onClick:(event:React.MouseEvent<HTMLButtonElement>)=>void;children:React.ReactNode}) {
 return <button className="rosterclu" data-tip={tip} aria-label={label} onClick={onClick}><span className="cluav">{children}</span><span className="clun">{count||'+'}</span></button>;
}
