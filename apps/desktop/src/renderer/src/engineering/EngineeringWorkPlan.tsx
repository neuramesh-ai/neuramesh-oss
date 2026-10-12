import { isEngineeringPlanReport, stripMarkdownInline, type EngineeringPlanReport, type EngineeringPlanProgress } from '@neuramesh/shared';
import { Md } from '../md/Md';
import { IconCheck, IconThreads } from '../ui/icons';
import { engineeringPlanItems } from './activity';
import styles from './EngineeringWorkPlan.module.css';

/** The transcript previews the plan that the pane shows in full. The message owns its version, so later replies
 * cannot move the plan or replace an earlier proposal with the latest revision. */
export function EngineeringWorkPlan({ text, progress, report, inline = false, earlier = false, onOpen }: { text: string; progress?: EngineeringPlanProgress | null; report?: EngineeringPlanReport; inline?: boolean; earlier?: boolean; onOpen?: () => void }) {
  const items = engineeringPlanItems(text).map((item, index) => progress?.started && progress.statuses[index] ? { ...item, status: progress.statuses[index] === 'completed' ? 'complete' : progress.statuses[index] === 'in_progress' ? 'active' : 'pending' } : item);
  const complete = items.filter((item) => item.status === 'complete').length;
  const firstStep = text.search(/^\s*(?:\d+[.)]|[-*+]\s+\[[ xX~>-]\])\s+\S/m);
  const summary = firstStep < 0 ? text : text.slice(0, firstStep).trim();
  const preview = stripMarkdownInline(items.length ? items.slice(0, 2).map((item, i) => `${i + 1}. ${item.text}`).join(' · ') : summary).replace(/\s+/g, ' ').trim();
  if (inline) return <div className={styles.proposal} data-plan-proposal>
    {isEngineeringPlanReport(report) ? <section className={styles.overview} aria-label="Agent plan explanation">
      <Md text={report.investigation} />
      <ul aria-label="Key decisions">{report.decisions.map((point, index) => <li key={index}><Md text={point} /></li>)}</ul>
      <div className={styles.nextStep} aria-label="Next step"><Md text={report.nextStep} /></div>
    </section> : null}
    <div className={styles.inline} data-work-plan="inline">
      <button type="button" className={styles.previewCard} onClick={onOpen} aria-label="Open plan" disabled={!onOpen}>
        <span className={styles.previewHead}><span><IconThreads s={14} /><b>Work plan</b><small>Preview</small></span><em>{items.length ? `${items.length} step${items.length === 1 ? '' : 's'}` : 'Plan'}</em></span>
        <span className={styles.summary}><span className={styles.preview}>{preview}</span></span>
        <span className={styles.footer}><span>{items.length ? `${items.length} step${items.length === 1 ? '' : 's'} in the full plan` : 'Read the full plan'}</span><b>Open plan <span aria-hidden>↗</span></b></span>
      </button>
    </div>
  </div>;
  return <div className="engplan" data-work-plan="pane">
    <section className={`engplantasks ${styles.card}`} aria-label="Work plan">
      <header><span><IconThreads s={14} /><b>{earlier ? 'Earlier work plan' : 'Work plan'}</b></span>{items.length ? <em>{complete ? `${complete} of ${items.length} complete` : `${items.length} step${items.length === 1 ? '' : 's'}`}</em> : null}</header>
      {summary ? <div className={styles.summary}><Md text={summary} /></div> : null}
      {items.length ? <ol aria-label="Work plan steps">{items.map((item, index) => <li className={item.status} key={`${index}-${item.text}`}>
        <span className="engplanmarker" aria-label={item.status}>{item.status === 'complete' ? <IconCheck s={12} /> : <i />}</span>
        <span><small>Step {index + 1}</small><b>{item.text}</b></span>
      </li>)}</ol> : null}
    </section>
    {items.length ? <details className="engplansource"><summary>Full plan and guardrails</summary><div className="plBody"><Md text={text} /></div></details> : null}
  </div>;
}
