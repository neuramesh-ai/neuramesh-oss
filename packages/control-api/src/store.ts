// The store barrel: types + contract + the in-memory implementation.
//
// 40 test files and every consumer import from './store' — keeping this path stable is
// what let the layer be split without touching any of them.
export * from './store/types';
export type { Store } from './store/contract';
export { MemoryStore } from './store/memory';
