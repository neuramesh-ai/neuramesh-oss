// Metro hands an asset import to the app as its registry id, a number. Expo's tsconfig base
// declares no asset modules, so the phone's font cuts (src/fonts.ts) need this one line.
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
