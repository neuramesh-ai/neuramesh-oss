// The rooms and the loop (docs/designs/foundry-landing-fast-to-done.md §03, §04).
import { LOOP, ROOMS } from './copy';
import { Cells, Head } from './fast';
import { IconLock } from './icons';
import { shotFor, useTheme } from './theme';

// A real capture of the app inside a browser chrome bar, on grid paper. Never a hand-built
// frame: the picture must be the product as it is (the round-2 ruling). The capture is the
// opposite theme of the page (theme.ts shotFor), so the frame contrasts with the paper.
export function Frame({ room, task, url, shot, alt, width, height, inner }: { room: string; task: string; url: string; shot: string; alt: string; width: number; height: number; inner?: boolean }) {
  const src = shotFor(shot, useTheme());
  return (
    <div className={`l-stage${inner ? ' in' : ''}`} data-reveal>
      <div className="l-cap"><span>{room}</span><i /><span>{task}</span><i /><span className="l-live"><em />live</span></div>
      <div className="l-win">
        <div className="l-chrome">
          <div className="l-dots"><i /><i /><i /></div>
          <div className="l-url"><IconLock />{url}</div>
        </div>
        <img src={src} alt={alt} width={width} height={height} loading={inner ? 'lazy' : 'eager'} decoding="async" />
      </div>
    </div>
  );
}

export function Rooms() {
  return (
    <section className="wrap l-sec" id="rooms">
      <Head n={ROOMS.n} kicker={ROOMS.kicker} title={ROOMS.title} muted={ROOMS.titleMuted} lead={ROOMS.lead} />
      <Cells cells={ROOMS.cells} hash />
    </section>
  );
}

export function Loop() {
  return (
    <section className="wrap l-sec l-tight" id="loop">
      <Head n={LOOP.n} kicker={LOOP.kicker} title={LOOP.title} muted={LOOP.titleMuted} lead={LOOP.lead} />
      <Cells cells={LOOP.cells} />
      <Frame room={LOOP.frame.room} task={LOOP.frame.task} url={LOOP.frame.url} shot="loop-build" alt={LOOP.frame.alt} width={1440} height={868} inner />
    </section>
  );
}
