import type { EngineeringChange } from './domain';

export const SAMPLE_CHANGES: EngineeringChange[] = [
  {
    path: 'src/components/AuthCallback.tsx', kind: 'modified',
    before: `useEffect(() => {\n  exchangeCode(code).then(navigateHome)\n}, [code])\n`,
    after: `useEffect(() => {\n  const request = new AbortController()\n  exchangeCode(code, request.signal).then(navigateHome)\n  return () => request.abort()\n}, [code])\n`,
    diff: `diff --git a/src/components/AuthCallback.tsx b/src/components/AuthCallback.tsx\nindex e421af0..bc21e2a 100644\n--- a/src/components/AuthCallback.tsx\n+++ b/src/components/AuthCallback.tsx\n@@ -1,3 +1,5 @@\n useEffect(() => {\n-  exchangeCode(code).then(navigateHome)\n+  const request = new AbortController()\n+  exchangeCode(code, request.signal).then(navigateHome)\n+  return () => request.abort()\n }, [code])\n`,
  },
  {
    path: 'src/components/AuthCallback.test.tsx', kind: 'added', before: '',
    after: `it('cancels the exchange when the route unmounts', async () => {\n  const { unmount } = render(<AuthCallback code="demo" />)\n  unmount()\n  expect(exchangeSignal.aborted).toBe(true)\n})\n`,
    diff: `diff --git a/src/components/AuthCallback.test.tsx b/src/components/AuthCallback.test.tsx\nnew file mode 100644\nindex 0000000..78ce3d1\n--- /dev/null\n+++ b/src/components/AuthCallback.test.tsx\n@@ -0,0 +1,5 @@\n+it('cancels the exchange when the route unmounts', async () => {\n+  const { unmount } = render(<AuthCallback code="demo" />)\n+  unmount()\n+  expect(exchangeSignal.aborted).toBe(true)\n+})\n`,
  },
];

export const WORK_PLAN = `## Work Plan\n\n1. Trace the callback lifecycle and reproduce the duplicate exchange.\n2. Make the in-flight request cancellable when the route unmounts.\n3. Add regression coverage for unmount and a successful callback.\n4. Run the focused test, typecheck, and the application build.\n\n**Guardrails:** no auth protocol changes; no token material leaves the machine.`;
