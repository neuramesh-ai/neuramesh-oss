// The marketing upgrade prompt — the nudge shown to a room that is not marketing-kind yet.
// Extracted from App.tsx (track A2).
import { Modal } from '../ui/Modal';

// One-time upgrade prompt for a pre-kinds #marketing room (plan §4.1a): shown on open while
// the room is still kind='build'; confirm converts via channel.set_kind (free on every plan)
// — the DB is never backfilled. "Not now" dismisses for the session; the settings Kind row
// stays the durable path, and renaming the room ends the prompt forever.
export function MarketingUpgradePrompt({ onConvert, onClose }: { onConvert: () => void; onClose: () => void }) {
  return (
    <Modal title="Meet the Marketing HQ" onClose={onClose} footer={
      <>
        <button className="btn sm" onClick={onClose}>Not now</button>
        <button className="btn primary sm" style={{ width: 'auto', marginTop: 0, padding: '5.5px 16px' }} onClick={onConvert}>Turn into Marketing HQ →</button>
      </>
    }>
      <p className="mkpromptbody">This channel can now run the marketing crew — brand docs, a content calendar, a library. <b>Everything already here stays</b>: messages, tasks, history.</p>
      <p className="modalhint" style={{ marginTop: 8 }}>Shown once per channel · also available any time in channel settings</p>
    </Modal>
  );
}
