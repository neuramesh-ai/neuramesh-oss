// The canvas kit: what every json-render canvas in NeuraMesh shares. Finance (packages/finance-ui) and
// Marketing build their catalogs from these parts, and control-api validates each spec with finishSpec.
export { createSpecStreamParser, emptySpec, type SpecPatch } from './stream';
export { finishSpec, MAX_ELEMENTS, type FinishedSpec } from './finish';
export { followUpsOf, type NextAsk } from './followups';
export { amount, ask, format, size, text, followUps, insightCard, kpiList, kpiTile, type Size } from './components';
export { applySpecPatch, type Spec } from '@json-render/core';
