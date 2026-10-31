import { DomainError } from '../errors';

/** Offering work is not permission to replace an existing specialist. */
export function requireTaskOwner(ownerId: unknown, agentId: unknown): void {
  if (ownerId && ownerId !== agentId) {
    throw new DomainError('NOT_PERMITTED', 'This task already has an owner. Create a separate task for another specialist.');
  }
}
