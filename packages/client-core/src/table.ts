export const column = { text: { type: 'text' }, integer: { type: 'integer' } } as const;
type Column = typeof column[keyof typeof column];
/** Client-owned SQL schema. These definitions have no dependency on a transport SDK. */
export class Table {
  readonly indexes: Array<{ name: string; columns: Array<{ name: string }> }>;
  constructor(readonly columnMap: Record<string, Column>, options: { indexes?: Record<string, string[]> } = {}) {
    this.indexes = Object.entries(options.indexes ?? {}).map(([name, columns]) => ({ name, columns: columns.map(name => ({ name })) }));
  }
}
