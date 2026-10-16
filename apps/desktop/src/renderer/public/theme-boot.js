(function () {
  var DEFAULT = 'system'; // DEFAULT_THEME_PREF in src/theme/theme.ts
  var d = document.documentElement, ls, pref = DEFAULT;
  try { ls = window.localStorage; pref = ls.getItem('nm:theme') || DEFAULT; } catch (e) { /* storage can be unavailable */ }
  if (!/^(dark|light|soft-dark|cream-oak|paper-light|paper-dark|paper-cream-oak|system|paper-system)$/.test(pref)) pref = DEFAULT;
  var light = !!(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
  var id = pref === 'system' ? (light ? 'light' : 'soft-dark') : pref === 'paper-system' ? (light ? 'paper-light' : 'paper-dark') : pref;
  d.dataset.theme = id;
  d.dataset.look = id.indexOf('paper-') === 0 ? 'paper' : 'elevated';
})();
