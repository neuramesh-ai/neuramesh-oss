// Rex's suggestion pills: a pill is a pre-drafted MESSAGE, never a hidden command.
import { useState } from 'react';

// Suggestion pills (docs/design/rex-suggestion-pills-2026-07): the orchestrator's predicted
// follow-ups, rendered under his newest reply. A pill is a pre-drafted message, never a hidden
// command — click sends the text through the surface's own send seam, ⌥-click drops it into the
// composer to edit, ✕ dismisses this row for the session. The loops decide WHERE it shows
// (suggestionTarget below); the row only owns its pressed/dismissed state.
export function SuggestionRow({ suggestions, onPick, onEdit }: { suggestions: string[]; onPick: (text: string) => void; onEdit: (text: string) => void }) {
  const [gone, setGone] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  if (gone || suggestions.length === 0) return null;
  return (
    <div className="sugrow" role="group" aria-label="Suggested replies">
      {suggestions.map((s) => (
        <button
          key={s}
          className={`sug${sent === s ? ' on' : ''}`}
          disabled={sent != null}
          title="Sends as your reply — ⌥-click to edit first"
          onClick={(e) => {
            if (e.altKey) return onEdit(s);
            setSent(s);
            onPick(s);
          }}
        >
          {s}
        </button>
      ))}
      <button className="sugx" title="Dismiss suggestions" aria-label="Dismiss suggestions" onClick={() => setGone(true)}>✕</button>
    </div>
  );
}
