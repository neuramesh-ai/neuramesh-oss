/** A dedicated ingress reuses the control API's authentication and authorization. It exposes
 * only brain routes, so adding a large-body path never exposes the rest of the API on the relay. */
export function brainIngress(fetchApi: (request: Request) => Response | Promise<Response>, ready: () => Promise<void>) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/brain-healthz' && request.method === 'GET') {
      try { await ready(); return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } }); }
      catch { return Response.json({ ok: false }, { status: 503, headers: { 'cache-control': 'no-store' } }); }
    }
    if (!path.startsWith('/v1/brain/')) return Response.json({ error: 'not found' }, { status: 404 });
    const response = await fetchApi(request);
    response.headers.set('cache-control', 'private, no-store');
    response.headers.set('x-content-type-options', 'nosniff');
    return response;
  };
}
