import { useState } from 'react';
import type { WTabMode } from '../src/wtabs';
import { createRoot } from 'react-dom/client';
import { applyTheme } from '../src/theme/theme';
import '../src/tokens.css';

const files = await Promise.all(['clip.mp4', 'poster.png', 'track.wav'].map(async name => {
  const data = new Uint8Array(await (await fetch(new URL(`../../../../hq/preview/artifact-fixtures/${name}`, import.meta.url))).arrayBuffer());
  return { id: name, name: `launch/${name}`, mime: 'application/octet-stream', inline_content: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...data))}`, created_at: '2026-10-14T10:00:00Z' };
}));
files.push({ id: 'storyboard', name: 'launch/storyboard.md', mime: 'text/markdown', inline_content: '# Launch storyboard\n\n1. Introduce the feature.\n2. Show the finished result.\n\n**Ready to review.**', created_at: '2026-10-14T10:00:00Z' });
files.push({ id: 'captions', name: 'launch/captions.srt', mime: 'application/octet-stream', inline_content: `data:application/octet-stream;base64,${btoa('1\n00:00:00,000 --> 00:00:01,000\nHello from NeuraMesh\n')}`, created_at: '2026-10-14T10:00:00Z' });
files.push({ id: 'bundle', name: 'launch/bundle.zip', mime: 'application/octet-stream', inline_content: 'data:application/octet-stream;base64,AAECA/8=', created_at: '2026-10-14T10:00:00Z' });
let failure = false;
(window as any).nm = {
  threadArtifacts: async () => { if (failure) throw new Error('Artifact service unavailable.'); return { artifacts: files.map(file => ({ ...file, inline_content: null })) }; },
  artifact: async (id: string) => { if (failure) throw new Error('The artifact could not load.'); return { artifact: files.find(file => file.id === id) }; },
};
const { useCodingArtifacts } = await import('../src/thread/CodingArtifacts');
const { WFileView } = await import('../src/wtabs/filetree');
const { Md } = await import('../src/md/Md');
const { EngineeringWorkspaceTabs } = await import('../src/engineering/EngineeringEditor');
const { ThreadOverviewBody, ThreadOverviewEnvironment, useThreadOverview } = await import('../src/thread/ThreadOverview');
const { artifactOverviewSection } = await import('../src/thread/overview-sections');

function Content() {
  const [doc, setDoc] = useState<{ name: string; content: string } | null>(null);
  const [mode, setMode] = useState<WTabMode>('preview');
  const [theme, setTheme] = useState('dark');
  const [revision, setRevision] = useState(0);
  const open = (d: { file: string; doc: string }) => { setDoc({ name: d.file, content: d.doc }); setMode('preview'); };
  const artifacts = useCodingArtifacts('fixture', revision, open);
  const overview = useThreadOverview('thread:fixture', [artifactOverviewSection(artifacts.rows, open)]);
  return <>
    <header style={{ padding: 20, display: 'flex', flexWrap: 'wrap', gap: 12 }}><b>Artifact previews · UI fixture</b><span>No model or production data.</span>
      <button className="btn" onClick={() => { applyTheme(theme === 'dark' ? 'light' : 'dark'); setTheme(theme === 'dark' ? 'light' : 'dark'); }}>Switch theme</button>
      <button className="btn" onClick={() => { failure = !failure; setRevision(n => n + 1); }}>Toggle failure</button><span style={{ paddingRight: 24 }}>{overview.toggle}</span>
    </header>
    <main style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', minHeight: '85vh' }}>
      <section style={{ padding: 20, minWidth: 0 }}><ThreadOverviewBody overview={overview} label="Media delivery">
        <Md text={'Delivered in `.nm-artifacts/launch/`:\n\n- `clip.mp4` — one-second video\n- `poster.png` — cover\n- `track.wav` — soundtrack\n- `captions.srt`\n- [Storyboard](.nm-artifacts/launch/storyboard.md)\n\n```sh\nclip.mp4\n```'} fileRef={artifacts.fileRef} onOpenFile={artifacts.openFile} />
        {artifacts.card}
      </ThreadOverviewBody></section>
      <aside style={{ minWidth: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)' }}>
        <div style={{ height: 40, flex: 'none', overflowX: 'auto' }}><EngineeringWorkspaceTabs tab="artifacts" onTab={() => setDoc(null)} /></div>
        {doc ? <WFileView tab={{ id: doc.name, kind: 'file', title: doc.name, readOnly: true, mode }} doc={doc} onMode={setMode} onDirty={() => {}} /> : artifacts.pane}
      </aside>
    </main>
  </>;
}
createRoot(document.getElementById('root')!).render(<ThreadOverviewEnvironment.Provider value={{ workspace: 'fixture', owner: 'thread:fixture', paneOpen: false, expanded: false, processes: [], openLink: () => {} }}><Content /></ThreadOverviewEnvironment.Provider>);
