// Identity display helpers — extracted from App.tsx (track A1).

export const DEV_USER = '00000000-0000-0000-0000-000000000001';

// The signed-in human's display name + initial, resolved from their Clerk email (the stored
// member name is a generic "owner" for Clerk users, since workspace.create can't see the
// email). e.g. "george.delson@x" → "George Delson"; initial → "G".
export function selfDisplayName(email?: string | null): string | null {
  if (!email) return null;
  const local = email.split('@')[0] || email;
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}
export function selfInitial(email?: string | null, fallback = 'U'): string {
  return (email?.trim()?.[0] ?? fallback).toUpperCase();
}
// The name to show for the signed-in user. A display_name they've actually customized
// (one that differs from the bare email local-part the migration defaults to) wins — so
// editing your profile is reflected everywhere it shows your name. Otherwise fall back to
// the prettified email, so a never-edited profile still reads "Janedoe", not "janedoe".
export function selfLabel(displayName?: string | null, email?: string | null): string {
  const dn = displayName?.trim();
  const emailLocal = email?.split('@')[0]?.trim();
  if (dn && dn.toLowerCase() !== (emailLocal ?? '').toLowerCase()) return dn;
  return selfDisplayName(email) ?? dn ?? 'you';
}

export let selfMachine: string | null = null;
/** The shell learns this machine's name at boot and publishes it here. Readers import the
 *  binding and see the update — only this module may assign it. */
export function setSelfMachine(name: string | null) { selfMachine = name; }
