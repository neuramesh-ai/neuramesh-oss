// smallest possible live check: can the from-scratch client authenticate to the current
// kube context and list managed namespaces? (kubeconfig exec-plugin path included.)
import { Kube, loadAuth } from '../src/kube.js';

const kube = new Kube(loadAuth());
const ns = await kube.list('v1', 'Namespace', 'neuramesh.io/managed=true');
console.log('live API auth OK — managed namespaces:', JSON.stringify(ns.map((n) => n.metadata.name)));
