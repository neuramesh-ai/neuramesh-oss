/** Maximum wait for an acknowledged Cloud Run stop/roll drain. Successful
 * snapshots park immediately. The 8.35GB production rehearsal needed176.4s
 * for one file upload, before turn grace, write flush, box save or a retry. */
export const CLOUDRUN_DRAIN_SECONDS = 600;
