import { useMemo, type ReactNode } from 'react';
import { highlightCode } from '../lib/highlight';
import { IconFile } from '../ui/icons';
import { reviewSource, type ReviewFile } from './change-review';
import styles from './EngineeringReview.module.css';

const labels = { added: 'Added', deleted: 'Deleted', modified: 'Modified', renamed: 'Renamed' };
const symbols = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R' };

export function ChangeCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return <span className={styles.counts} aria-label={`${additions} added lines, ${deletions} removed lines`}>
    <span className={styles.additions}>+{additions}</span><span className={styles.deletions}>−{deletions}</span>
  </span>;
}

function FileContent({ file }: { file: ReviewFile }) {
  const { text, notice } = reviewSource(file);
  const lines = useMemo(() => highlightCode(text, file.change.path).replace(/\n$/, '').split('\n'), [text, file.change.path]);
  if (notice) return <div className={styles.empty}>{notice}</div>;
  if (!text) return <div className={styles.empty}>{file.change.kind === 'deleted' ? 'This file was deleted.' : 'This file is empty.'}</div>;
  return <div className={styles.codeScroll} tabIndex={0} aria-label={`File content for ${file.change.path}`}>
    {file.change.kind === 'deleted' ? <p className={styles.sourceNotice}>This file was deleted. This is the previous content.</p> : null}
    <div className={styles.sourceCode}>
      {lines.map((html, index) => <div className={styles.sourceLine} key={index}>
        <span className={styles.lineNumber} aria-hidden>{index + 1}</span>
        <code dangerouslySetInnerHTML={{ __html: html || ' ' }} />
      </div>)}
    </div>
  </div>;
}

function FileDiff({ file }: { file: ReviewFile }) {
  if (file.binary) return <div className={styles.empty}>This is a binary file. No text diff is available.</div>;
  if (!file.lines.length && /^(?:\[diff|Open the repository)/.test(file.change.diff)) return <div className={styles.empty}>{file.change.diff}</div>;
  if (!file.lines.length && file.change.previewError) return <div className={styles.empty}>{file.change.previewError}</div>;
  if (!file.lines.length) return <div className={styles.empty}>{file.kind === 'renamed' ? 'The file path changed. The content is unchanged.' : 'No text changes in this file.'}</div>;
  return <div className={styles.codeScroll} tabIndex={0} aria-label={`Diff for ${file.change.path}`}>
    <>{file.change.previewError && <p className={styles.sourceNotice}>{file.change.previewError}</p>}<div className={styles.diffCode}>
      <div className={styles.gutterLabels} aria-hidden><span>Old</span><span>New</span></div>
      {file.lines.map((line, index) => <div className={`${styles.diffLine} ${styles[line.kind]}`} key={index}>
        <span className={styles.lineNumber} aria-hidden>{line.oldLine}</span>
        <span className={styles.lineNumber} aria-hidden>{line.newLine}</span>
        <span className={styles.marker} aria-hidden>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}</span>
        <code>{line.text || ' '}</code>
      </div>)}
    </div>
  </></div>;
}

export function EngineeringReview({ files, selectedPath, onSelectPath, source = false, artifacts }: {
  files: ReviewFile[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  source?: boolean;
  artifacts?: ReactNode;
}) {
  const selected = files.find((file) => file.change.path === selectedPath) ?? files[0];
  const totals = files.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 });
  return <section className={styles.review} aria-label={source ? 'Session files' : 'Code changes'}>
    <header className={styles.summary}><b>{files.length} {files.length === 1 ? 'file' : 'files'} {source ? '' : 'changed'}</b>{!source && <ChangeCounts {...totals} />}</header>
    <div className={styles.workspace}>
      <nav className={styles.fileList} aria-label={source ? 'Session files' : 'Changed files'}>
        {artifacts}
        {files.map((file) => <button key={file.change.path} className={`${styles.fileButton} ${selected === file ? styles.selected : ''}`}
          aria-label={`${source ? 'Open' : 'Review'} ${file.change.path}`} aria-pressed={selected === file} title={file.change.path} onClick={() => onSelectPath(file.change.path)}>
          <span className={`${styles.badge} ${styles[file.kind]}`} title={labels[file.kind]}>{symbols[file.kind]}</span>
          <span className={styles.filePath}>{file.change.path}</span>
          {!source && <ChangeCounts additions={file.additions} deletions={file.deletions} />}
        </button>)}
        {!files.length && <p className={styles.noFiles}>No files changed in this session.</p>}
      </nav>
      <article className={styles.detail} key={selected?.change.path ?? 'empty'}>
        {selected ? <>
          <header className={styles.fileHeader}>
            <div><IconFile s={14} /><b>{selected.change.path}</b></div>
            <span className={`${styles.status} ${styles[selected.kind]}`}>{labels[selected.kind]}{selected.binary ? ' · Binary' : ''}</span>
            {selected.previousPath && <small>From {selected.previousPath}</small>}
          </header>
          {source ? <FileContent file={selected} /> : <FileDiff file={selected} />}
        </> : <div className={styles.empty}>Select a file to view its content.</div>}
      </article>
    </div>
  </section>;
}
