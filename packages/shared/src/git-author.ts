/** Public GitHub identity of the NeuraMesh App, independent of the credential used to push. */
export const NEURAMESH_BOT = {
  name: 'neuramesh[bot]',
  email: '331048932+neuramesh[bot]@users.noreply.github.com',
} as const;

export function agentGitIdentity(identity: {name:string;email:string} = NEURAMESH_BOT) {
  return {
    GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email,
  };
}

export const PULL_REQUEST_SKILL = `Create a reviewable pull request on the task branch. In a NeuraMesh coding task, the host commits, pushes and opens the PR after verification. Keep code changes, tests and genuine evidence together. For agent-created commits use the NeuraMesh GitHub App account for both author and committer: ${NEURAMESH_BOT.name} <${NEURAMESH_BOT.email}>. Verify both fields with git show -s --format='%an <%ae> / %cn <%ce>' HEAD. Keep credentials out of the repository and leave the user's global Git identity alone. Report the pull request, commit and actual check outcomes. If a preview rejects the author, report the failing check and what an administrator must fix. Do not rewrite existing commits or create empty commits to force a deployment.`;
