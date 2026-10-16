import { useEffect, useState } from 'react';
import styles from './ArtifactMedia.module.css';

export function useArtifactUrl(blob: Blob | null): string | null {
  const [loaded, setLoaded] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setLoaded({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return loaded?.blob === blob ? loaded.url : null;
}

/** Browser-native controls keep playback user initiated. Unsupported codecs retain Download. */
export function ArtifactMedia({ name, kind, url }: { name: string; kind: string; url: string }) {
  const [failed, setFailed] = useState(false);
  return <div className={styles.media}>
    {kind === 'video' && <video aria-label={name} controls preload="metadata" src={url} onError={() => setFailed(true)} />}
    {kind === 'audio' && <audio aria-label={name} controls preload="metadata" src={url} onError={() => setFailed(true)} />}
    {kind === 'image' && <img alt={name} src={url} onError={() => setFailed(true)} />}
    {kind === 'pdf' && <object type="application/pdf" aria-label={name} data={url}><p>PDF preview is unavailable. Use Download to open this file.</p></object>}
    {(failed || kind === 'download') && <p role={failed ? 'alert' : undefined}>{failed ? 'This browser could not preview the file.' : 'This file type has no preview.'} Use Download to open it.</p>}
  </div>;
}
