export type Address =
  | { kind: 'human'; id: string }
  | { kind: 'agent'; id: string }
  | { kind: 'machine'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'channel'; slug: string }
  | { kind: 'project'; slug: string }
  | { kind: 'resource'; type: string; id: string };

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function parseAddress(input: string): Address | null {
  const colon = input.match(/^(human|agent|machine|task):(.+)$/);
  if (colon) {
    const id = colon[2]!;
    if (!SEGMENT.test(id)) return null;
    return { kind: colon[1] as 'human' | 'agent' | 'machine' | 'task', id };
  }

  const slash = input.split('/');
  if (slash[0] === 'channel' && slash.length === 2 && SEGMENT.test(slash[1]!)) {
    return { kind: 'channel', slug: slash[1]! };
  }
  if (slash[0] === 'project' && slash.length === 2 && SEGMENT.test(slash[1]!)) {
    return { kind: 'project', slug: slash[1]! };
  }
  if (slash[0] === 'resource' && slash.length === 3 && SEGMENT.test(slash[1]!) && SEGMENT.test(slash[2]!)) {
    return { kind: 'resource', type: slash[1]!, id: slash[2]! };
  }
  return null;
}

export function formatAddress(a: Address): string {
  switch (a.kind) {
    case 'human':
    case 'agent':
    case 'machine':
    case 'task':
      return `${a.kind}:${a.id}`;
    case 'channel':
      return `channel/${a.slug}`;
    case 'project':
      return `project/${a.slug}`;
    case 'resource':
      return `resource/${a.type}/${a.id}`;
  }
}

export function isAddress(input: string): boolean {
  return parseAddress(input) !== null;
}
