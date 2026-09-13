import {
  PACKS,
  MODEL_ID_SET,
  STARTER_MODEL,
  isCustomPackId,
  resolvePackRoles,
  seatModel,
  type CustomModelPack,
} from '@neuramesh/shared';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';
import { engineeringAuthHeaders } from './engineering-provider';

interface ReplicaReader {
  getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]>;
}

export interface EngineeringBrainResolution {
  modelId: string;
  agentId?: string;
}

interface EngineeringBrainOptions {
  apiUrl: string;
  machineToken: string;
  /** the member's headers instead of the machine's bearer (the desktop Code bridge, slice B1) */
  authHeaders?: () => Promise<Record<string, string>>;
  workspaceId: string;
  fetchImpl?: typeof fetch;
}

interface DeveloperSeatRow {
  id: string;
  model: string | null;
  model_source: string | null;
}

interface ProjectBrainRow {
  model_pack: string | null;
}

async function customPacks(opts: EngineeringBrainOptions, packId: string | null): Promise<CustomModelPack[]> {
  if (!isCustomPackId(packId)) return [];
  const call = opts.fetchImpl ?? fetch;
  const response = await call(`${opts.apiUrl}/v1/model-packs?workspace=${encodeURIComponent(opts.workspaceId)}`, {
    headers: await engineeringAuthHeaders(opts),
  });
  if (!response.ok) throw new Error(`Engineering could not resolve the project brain (${response.status}).`);
  const body = (await response.json()) as { packs?: unknown[] };
  return (body.packs ?? []).filter((value): value is CustomModelPack => {
    if (!value || typeof value !== 'object') return false;
    const pack = value as Partial<CustomModelPack>;
    return typeof pack.id === 'string' && typeof pack.name === 'string' && !!pack.roles && typeof pack.roles.developer === 'string';
  });
}

async function selectedPackModel(opts: EngineeringBrainOptions, packId: string): Promise<string> {
  const custom = await customPacks(opts, packId);
  const roles = resolvePackRoles(packId, custom);
  if (!roles || (!PACKS[packId] && !custom.some((pack) => pack.id === packId))) {
    throw new Error('The selected Engineering brain is not available in this workspace.');
  }
  return roles.developer;
}

/** Resolve the Engineering model exactly like any other developer wake.
 * Manual developer pin > repository project's brain > materialized workspace developer seat. */
export async function resolveEngineeringBrain(
  db: ReplicaReader,
  opts: EngineeringBrainOptions,
  meta: Pick<EngineeringMachineOpenMeta, 'repoId' | 'modelId' | 'brainPack' | 'projectId'>,
): Promise<EngineeringBrainResolution> {
  const [seats, projects] = await Promise.all([
    db.getAll<DeveloperSeatRow>(
      `select id, model, model_source
         from agents
        where workspace_id = ? and role = 'developer' and retired_at is null
          and coalesce(kind, 'local') != 'remote'
        order by case when lower(name) = 'patch' then 0 else 1 end,
                 case when model_source = 'manual' then 0 else 1 end,
                 lower(name)
        limit 1`,
      [opts.workspaceId],
    ),
    db.getAll<ProjectBrainRow>(
      `select p.model_pack
         from projects p
         join project_repos pr on pr.project_id = p.id
        where p.workspace_id = ? and pr.repo_id = ? and (? is null or p.id = ?)
        order by coalesce(pr.is_primary, 0) desc, coalesce(p.is_default, 0) desc, p.id
        limit 1`,
      [opts.workspaceId, meta.repoId, meta.projectId ?? null, meta.projectId ?? null],
    ),
  ]);
  const seat = seats[0] ?? null;
  const project = projects[0] ?? null;
  if (meta.projectId && !project) throw new Error('The selected project is not connected to this repository in the workspace.');
  const currentModel = seat?.model || STARTER_MODEL;
  // A direct Code model selection is machine-validated against the shared allow-list. The
  // browser chooses an id, never a provider credential or endpoint; provider resolution below
  // still proves the workspace can serve it.
  if (meta.modelId) {
    if (!MODEL_ID_SET.has(meta.modelId)) throw new Error('The selected Code model is not available in this workspace.');
    return { modelId: meta.modelId, ...(seat?.id ? { agentId: seat.id } : {}) };
  }
  // An explicit composer selection is a per-task brain, so it is stronger than the normal
  // developer-seat/project inheritance. The browser supplies only a pack id; this machine-owned
  // lookup decides the actual model and rejects unknown or cross-workspace custom packs.
  if (meta.brainPack) {
    return {
      modelId: await selectedPackModel(opts, meta.brainPack),
      ...(seat?.id ? { agentId: seat.id } : {}),
    };
  }
  const packs = await customPacks(opts, project?.model_pack ?? null);
  return {
    modelId: seatModel({
      role: 'developer',
      currentModel,
      modelSource: seat?.model_source,
      projectPack: project?.model_pack,
      custom: packs,
    }),
    ...(seat?.id ? { agentId: seat.id } : {}),
  };
}
