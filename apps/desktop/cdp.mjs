// Minimal CDP driver: evaluate an expression in the live app window.
import { WebSocket } from 'ws';
const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('no page target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
const expr = process.argv[2];
await new Promise((res) => ws.on('open', res));
let id = 0;
const send = (method, params) => new Promise((res) => {
  const myId = ++id;
  const onMsg = (raw) => { const m = JSON.parse(raw.toString()); if (m.id === myId) { ws.off('message', onMsg); res(m.result); } };
  ws.on('message', onMsg);
  ws.send(JSON.stringify({ id: myId, method, params }));
});
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r?.result?.value ?? r?.exceptionDetails?.text ?? r, null, 1));
ws.close();
