/** the enum of Gemini schema types, as `@google/genai` exports it (passed in, so this stays a pure function) */
type GeminiTypes = { STRING: unknown; NUMBER: unknown; BOOLEAN: unknown; ARRAY: unknown; OBJECT: unknown };

/**
 * zod shape → a Gemini parameter Schema. describe() text rides through as the field description.
 * OBJECTS NEST (2026-09-19, the local fleet harness): `draft_posts` takes `posts: array(object)`, and
 * the old table mapped every unknown zod type to STRING, so the house model saw `items: STRING`,
 * answered `["{body:", "imageBrief:", "script:", "}"]` ten times over and hit the turn cap. A
 * schema the model cannot satisfy is a tool the model cannot call.
 */
export function zodShapeToGemini(shape: Record<string, any>, Type: GeminiTypes): any | undefined {
  const unwrap = (t: any): { inner: any; optional: boolean } => {
    let inner = t; let optional = false;
    while (['ZodOptional', 'ZodNullable', 'ZodDefault'].includes(inner?._def?.typeName)) { optional = true; inner = inner._def.innerType; }
    return { inner, optional };
  };
  const geminiType = (t: any): any => {
    const tn = t?._def?.typeName;
    if (tn === 'ZodNumber') return { type: Type.NUMBER };
    if (tn === 'ZodBoolean') return { type: Type.BOOLEAN };
    if (tn === 'ZodArray') return { type: Type.ARRAY, items: geminiType(unwrap(t._def.type).inner) };
    if (tn === 'ZodEnum') return { type: Type.STRING, enum: t._def.values };
    if (tn === 'ZodObject') return zodShapeToGemini(typeof t._def.shape === 'function' ? t._def.shape() : t.shape, Type) ?? { type: Type.OBJECT };
    return { type: Type.STRING };
  };
  const keys = Object.keys(shape);
  if (!keys.length) return undefined; // no-arg tool → omit parameters
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [key, zt] of Object.entries(shape)) {
    const { inner, optional } = unwrap(zt);
    const description = (zt as any).description as string | undefined;
    properties[key] = { ...geminiType(inner), ...(description ? { description } : {}) };
    if (!optional) required.push(key);
  }
  return { type: Type.OBJECT, properties, ...(required.length ? { required } : {}) };
}
