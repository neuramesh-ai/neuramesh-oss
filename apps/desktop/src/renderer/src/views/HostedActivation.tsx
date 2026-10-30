import { useEffect, useState } from 'react';
import { Wordmark } from '../brand';
import { nm } from '../bridge/nm';
import { workspaceHost, webUrl } from '../weburl';

export function HostedActivation({ name, slug }: { name: string; slug: string }) {
  const [error, setError] = useState('');
  useEffect(() => {
    // workspaces refreshes the main process's membership cache; bootstrap paints that answer.
    const refresh = () => { void nm?.workspaces().catch(() => {}); };
    refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  return <div className="obwrap">
    <div className="obtopbar"><Wordmark size={17} /><span className="obprogname">{name}</span></div>
    <div className="obbody">
      <div className="obeyebrow">Your workspace is saved</div>
      <h1 className="obtitle">Choose where you work.</h1>
      <p className="obsub">Use this Mac for free with your own subscriptions, or add payment details in NeuraMesh HQ for cloud work. Your chats, files, and credits stay safe.</p>
      <p className="obsub">Your trial costs $0 today. HQ shows the trial end date, renewal price, and cancellation options.</p>
      <button className="btn primary" onClick={() => {
        setError('');
        void nm?.localStackStart?.().then((r) => { if (!r.ok) setError(r.error ?? 'Local mode did not open. Try again.'); }).catch(() => setError('Local mode did not open. Try again.'));
      }}>Use this Mac for free →</button>
      <button className="btn" onClick={() => {
        setError('');
        void nm?.openExternal(`${new URL(webUrl()).protocol}//${workspaceHost()}${encodeURIComponent(slug)}`).catch(() => setError('HQ did not open. Try again.'));
      }}>Continue in NeuraMesh HQ →</button>
      <p className="obhint">Return here after activation. The app checks your workspace automatically.</p>
      <button type="button" className="btn" onClick={() => void nm?.logout()}>Sign out</button>
      {error && <p role="alert">{error}</p>}
    </div>
  </div>;
}
