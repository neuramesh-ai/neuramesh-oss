// THE ROOM'S LIBRARY TAB — the artifacts shelved in the channel the shell is standing in.
//
// Split out of App(). Distinct from the workspace-wide Files destination: this one is scoped to
// `current`, which is the room, not the project.
//
// It OWNS its watch (state-ownership round, 2026-08-16): nm.watchLibrary attaches when the tab
// opens and detaches when it closes. Nothing outside this surface read the rows — the Files
// destination has its own workspace-wide watch (`libraryAll`) and always did.

import { useEffect, useState } from 'react';
import { nm } from '../bridge/nm';
import { DiffView } from '../views/docpreview';
import { themedMockupDoc } from '../design/plans';
import type { ArtifactUI } from '../bridge/rows-board';
import type { ChannelRow } from '../bridge/rows-rooms';

export function LibrarySurface({ current }: {
  current: ChannelRow | null;
}) {
  const [library, setLibrary] = useState<ArtifactUI[]>([]);
  const [openLibArt, setOpenLibArt] = useState<string | null>(null);

  useEffect(() => {
    if (!nm || !current) return;
    setOpenLibArt(null);
    return nm.watchLibrary(current.id, setLibrary);
  }, [current?.id]);

  return (
      <div className="libwrap">
        {!library.length && (
          <div className="empty">
            Nothing promoted yet — star an artifact in a task thread to add it to #{current?.slug}'s library.
          </div>
        )}
        {library.map((a) => (
          <div key={a.id} className="libitem">
            <button className={`artchip${openLibArt === a.id ? ' on' : ''}`} onClick={() => setOpenLibArt(openLibArt === a.id ? null : a.id)}>
              <span className="akind">{a.kind}</span> {a.name}
            </button>
            <span className="libmeta">
              {a.task_number ? `#${a.task_number} · ` : ''}
              {new Date(a.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </span>
            {openLibArt === a.id && a.inline_content && (
              a.kind === 'diff'
                ? <DiffView text={a.inline_content} />
                : a.kind === 'design'
                  ? <div className="libdsgfull"><iframe className="apvframe" sandbox="allow-scripts" srcDoc={themedMockupDoc(a.inline_content)} title={a.name} /></div>
                  : <pre className="diffview"><div className="dline">{a.inline_content}</div></pre>
            )}
          </div>
        ))}
      </div>
  );
}
