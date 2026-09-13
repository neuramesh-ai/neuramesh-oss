// Custom entry: load polyfills BEFORE expo-router requires any route (routes pull
// in @neuramesh/shared, whose ULID factory needs crypto.getRandomValues at module
// load). Then hand off to the normal expo-router entry.
import './src/polyfills';
import 'expo-router/entry';
