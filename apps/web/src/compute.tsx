// Shared compute: the workspace's machines are one pool, lent by their owners and checked by the
// server on every wake (docs/design/member-machines-2026-09/plan.md). The section sits between
// the surfaces and pricing, because it is the reason Pro costs what it costs.
import { COMPUTE } from './copy';
import { Cells, Head } from './fast';

export function Compute() {
  return (
    <section className="wrap l-sec l-tight" id="compute">
      <Head n={COMPUTE.n} kicker={COMPUTE.kicker} title={COMPUTE.title} muted={COMPUTE.titleMuted} lead={COMPUTE.lead} />
      <Cells cells={COMPUTE.cells} />
    </section>
  );
}
