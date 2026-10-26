import type { OrchTransportArgs } from './orchturn';

export function orchToolsToBridge(tools: OrchTransportArgs['tools']) {
  const jsonType = (t: any): any => {
    const tn = t?._def?.typeName;
    if (['ZodOptional', 'ZodNullable', 'ZodDefault'].includes(tn)) return jsonType(t._def.innerType);
    if (tn === 'ZodNumber') return { type: 'number' };
    if (tn === 'ZodBoolean') return { type: 'boolean' };
    if (tn === 'ZodArray') return { type: 'array', items: jsonType(t._def.type) };
    if (tn === 'ZodObject') return inputSchemaOf(typeof t._def.shape === 'function' ? t._def.shape() : t.shape);
    if (tn === 'ZodEnum') return { type: 'string', enum: t._def.values };
    return { type: 'string' };
  };
  const inputSchemaOf = (shape: Record<string, any>): any => {
    const properties: Record<string, any> = {}; const required: string[] = [];
    for (const [key, zt] of Object.entries(shape)) {
      let inner: any = zt; let optional = false;
      while (['ZodOptional', 'ZodNullable', 'ZodDefault'].includes(inner?._def?.typeName)) { optional = true; inner = inner._def.innerType; }
      const description = (zt as any).description as string | undefined;
      properties[key] = { ...jsonType(inner), ...(description ? { description } : {}) };
      if (!optional) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  };
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: inputSchemaOf(t.schema), run: (i: unknown) => t.run(i) }));
}
