import { z } from 'zod';
export const DestinationSchema = z.enum(['finance', 'marketing']);
export type Destination = z.infer<typeof DestinationSchema>;
export const DestinationPersonSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['human', 'agent']), name: z.string(), role: z.string(),
  description: z.string().nullable(), owner: z.boolean(), hasAccess: z.boolean(),
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
