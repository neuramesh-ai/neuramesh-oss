import { z } from 'zod';
export const DestinationSchema = z.enum(['finance', 'marketing', 'sales']);
export type Destination = z.infer<typeof DestinationSchema>;
export const DestinationPersonSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['human', 'agent']), name: z.string(), role: z.string(),
  description: z.string().nullable(), owner: z.boolean(), hasAccess: z.boolean(),
  // an agent's face and model, for a composer that picks who answers (Finance)
  emoji: z.string().nullable().optional(), model: z.string().optional(),
});
export type DestinationPerson = z.infer<typeof DestinationPersonSchema>;
export const DestinationAccessSchema = z.object({
  destination: DestinationSchema, canView: z.boolean(), canManage: z.boolean(), people: z.array(DestinationPersonSchema),
});
export type DestinationAccess = z.infer<typeof DestinationAccessSchema>;
export interface DestinationBridge {
  destinationAccess(destination: Destination): Promise<DestinationAccess>;
  destinationMember(destination: Destination, input: { kind: 'human' | 'agent'; id: string; on: boolean }): Promise<DestinationAccess>;
}
