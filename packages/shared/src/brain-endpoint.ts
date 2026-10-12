// the URL without its trailing slashes, in one pass: a /\/+$/ replace backtracks over a run of
// slashes that does not end the string, which is quadratic (CodeQL js/polynomial-redos)
const withoutTrailingSlashes = (url: string): string => {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
};

/** Only the first-party production API uses the dedicated large-body ingress. Custom and Local
 * installations stay on their configured API; never follow a remotely supplied credential target. */
export function brainApiBaseUrl(apiUrl: string): string {
  const base = withoutTrailingSlashes(apiUrl);
  return base === 'https://api.neuramesh.app' || base === 'https://hq.neuramesh.app'
    ? 'https://relay.neuramesh.app' : base;
}

export function controlApiRequestUrl(apiUrl: string, path: string): string {
  return `${path.startsWith('/v1/brain/') ? brainApiBaseUrl(apiUrl) : withoutTrailingSlashes(apiUrl)}${path}`;
}
