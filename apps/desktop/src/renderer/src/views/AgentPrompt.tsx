// The shipped prompt — the turn an agent actually runs (defaults/agents/<role>.yaml), block
// by block. READ-ONLY on purpose: prompt blocks are the product's behaviour, versioned and
// reviewed with the app; what a machine may change is Instructions, which ride every turn.
// Shown so nobody edits instructions blind against a turn they have never read.
//
// Split out of views/AgentDetails.tsx; the expanded-block state came with it, because
// nothing else in the panel ever read it.
import { useState } from 'react';

export function AgentPrompt({ prompt, agentName, hint }: { prompt: Record<string, string>; agentName: string; hint: boolean }) {
  const [promptOpen, setPromptOpen] = useState<string | null>(null); // which prompt block is expanded
  if (!prompt || Object.keys(prompt).length === 0) return null;
  return (
    <>
      <div className="sect agsect">Prompt<i />
        <span className="thismachine" title="defaults/agents — versioned with the app, same on every machine">shipped contract</span>
      </div>
      <div className="agprompt">
        {Object.entries(prompt).map(([k, v]) => (
          <div key={k} className={`agpblock${promptOpen === k ? ' open' : ''}`}>
            <button className="agpkey" onClick={() => setPromptOpen(promptOpen === k ? null : k)}>
              <i className="agpchev">{promptOpen === k ? '▾' : '▸'}</i>{k}
              <span className="agpsize">{v.length.toLocaleString()} chars</span>
            </button>
            {promptOpen === k && <pre className="agpbody">{v}</pre>}
          </div>
        ))}
      </div>
      {hint && (
        <p className="modalhint">The turn @{agentName} runs, verbatim. To change how it behaves on this machine, write Instructions above — they ride alongside these blocks and win where they overlap.</p>
      )}
    </>
  );
}

