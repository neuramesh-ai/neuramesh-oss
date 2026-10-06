// The GitHub owner proof's rows (0149, docs/design/github-owner-proof-2026-10/plan.md §Data): which
// repositories one person's own GitHub account could read through the App, as GitHub's user-token
// lists answered when that person sent the grant's code back with their own session. One row per
// (workspace, person, installation), ids and names only, never a token. One object, two
// implementations, the store/announce.ts way, so memory.ts and pgstore.ts (both at their size caps)
// each carry it on a line they already have.
//
// A proof counts for 24 hours, and only while its person is a human member of the workspace: the
// read checks the membership, and on postgres the row belongs to the membership itself (the foreign
// key cascades), so a person who leaves loses their rows at once.
import type postgres from 'postgres';

export const PROOF_TTL_MS = 24 * 3_600_000;

export interface GitHubProof {
  installationId: number;
  /** GET /user's id: the GitHub account that read; the login is for display only */
  githubUserId: number;
  githubLogin: string;
  /** GitHub's repository ids, the names' twins: a name GitHub gives to another repository later is not the one proven */
  repoIds: number[];
  /** owner/name, lowercased */
  repos: string[];
  provenAt: string;
}
export type ProofInput = Omit<GitHubProof, 'provenAt'>;

export interface GitHubProofStore {
  /** a new proof is the whole truth of what the person reads now: it replaces every row the person held in the workspace */
  replace(workspace: string, actor: string, proofs: ProofInput[]): Promise<void>;
  /** the person's rows younger than 24 hours, while the person is a human member of the workspace */
  fresh(workspace: string, actor: string): Promise<GitHubProof[]>;
  /** every row of the person in the workspace */
  forget(workspace: string, actor: string): Promise<void>;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** the test double: membership comes from the memory store's own map */
export class MemGitHubProofStore implements GitHubProofStore {
  rows: Array<GitHubProof & { workspace: string; actor: string }> = [];
  constructor(private readonly isMember: (workspace: string, userId: string) => boolean = () => false) {}
  async replace(workspace: string, actor: string, proofs: ProofInput[]): Promise<void> {
    await this.forget(workspace, actor);
    const provenAt = new Date().toISOString();
    for (const p of proofs) this.rows.push({ ...p, repos: p.repos.map(norm), repoIds: [...p.repoIds], provenAt, workspace, actor });
  }
  async fresh(workspace: string, actor: string): Promise<GitHubProof[]> {
    if (!this.isMember(workspace, actor)) return [];
    const since = Date.now() - PROOF_TTL_MS;
    return this.rows
      .filter((r) => r.workspace === workspace && r.actor === actor && Date.parse(r.provenAt) > since)
      .map(({ workspace: _w, actor: _a, ...p }) => ({ ...p, repos: [...p.repos], repoIds: [...p.repoIds] }));
  }
  async forget(workspace: string, actor: string): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.workspace === workspace && r.actor === actor));
  }
}

export class PgGitHubProofStore implements GitHubProofStore {
  constructor(private readonly sql: postgres.Sql) {}
  async replace(workspace: string, actor: string, proofs: ProofInput[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;   // one transaction: a resolve never reads half a proof
      await sql`delete from github_repo_proofs where workspace_id = ${workspace}::uuid and actor_id = ${actor}::uuid`;
      for (const p of proofs) {
        await sql`insert into github_repo_proofs (workspace_id, actor_id, installation_id, github_user_id, github_login, repo_ids, repos)
          values (${workspace}::uuid, ${actor}::uuid, ${p.installationId}::bigint, ${p.githubUserId}::bigint, ${p.githubLogin},
                  ${p.repoIds}::bigint[], ${p.repos.map(norm)}::text[])`;
      }
    });
  }
  async fresh(workspace: string, actor: string): Promise<GitHubProof[]> {
    const rows = await this.sql`select p.installation_id, p.github_user_id, p.github_login, p.repo_ids, p.repos, p.proven_at
      from github_repo_proofs p
      join workspace_members m on m.workspace_id = p.workspace_id and m.user_id = p.actor_id
      where p.workspace_id = ${workspace}::uuid and p.actor_id = ${actor}::uuid
        and p.proven_at > now() - make_interval(secs => ${PROOF_TTL_MS / 1000})
      order by p.installation_id`;
    return rows.map((r) => ({
      installationId: Number(r['installation_id']), githubUserId: Number(r['github_user_id']), githubLogin: (r['github_login'] as string) ?? '',
      repoIds: ((r['repo_ids'] as Array<string | number> | null) ?? []).map(Number), repos: (r['repos'] as string[] | null) ?? [],
      provenAt: new Date(r['proven_at'] as string).toISOString(),
    }));
  }
  async forget(workspace: string, actor: string): Promise<void> {
    await this.sql`delete from github_repo_proofs where workspace_id = ${workspace}::uuid and actor_id = ${actor}::uuid`;
  }
}
