import { getRandomValues, randomUUID } from 'expo-crypto';

// React Native has no global crypto.getRandomValues; ulidx (via @neuramesh/shared's
// event/ULID helpers) needs it and otherwise throws "Failed to find a reliable
// PRNG". Back it with expo-crypto, which is already in the native build (no extra
// native module). Loaded from index.js BEFORE expo-router pulls in any route.
// …and crypto.randomUUID: the shared Engineering session model mints its ids with it (the
// mobile-cloud round, S5), and Hermes has getRandomValues but not the UUID helper.
const existing = (globalThis as { crypto?: { getRandomValues?: unknown; randomUUID?: unknown } }).crypto;
if (!existing) {
  (globalThis as { crypto?: unknown }).crypto = { getRandomValues, randomUUID };
} else {
  if (typeof existing.getRandomValues !== 'function') existing.getRandomValues = getRandomValues;
  if (typeof existing.randomUUID !== 'function') existing.randomUUID = randomUUID;
}
