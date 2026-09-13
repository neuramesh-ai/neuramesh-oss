// Small text utilities — extracted from App.tsx (track A1).

export const cleanErr = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 160) : fallback;

// A COMMAND error, said plainly. Distinct from cleanErr above: it also strips the control-api's
// `/v1/commands failed NNN:` prefix and keeps more of the server's sentence, which is the whole
// value when the failure is a refused transition. Two files had this verbatim.
export const cleanCmdErr = (e: unknown) =>
  (e instanceof Error ? e.message : 'failed').replace(/^Error invoking remote method.*?: Error: /, '').replace(/^\/v1\/commands failed \d+: /, '').slice(0, 220);

// preview the slug the server will auto-generate from a project name (mirrors
// the control-api's slugify); the server still resolves collisions (-2, -3…).
export const slugifyName = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// An error said in one line, for a toast or an inline strip: shorter than cleanCmdErr, and
// it names the ACTION when the throw was not an Error at all.
export const errMsg = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 110) : 'action failed';
