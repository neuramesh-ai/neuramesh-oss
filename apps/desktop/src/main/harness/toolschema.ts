// Tool SCHEMAS — the zod shape a tool declares, rendered as the JSON Schema a model reads.
// Split out of harness/toolbus.ts.
import { type ZodRawShape, type ZodTypeAny } from 'zod';




// ── MCP advertisement (the loopback bridge for codex + gemini) ─────────────────────────────────
/**
 * Minimal zod-shape → JSON Schema, covering exactly the types the catalogue uses.
 *
 * Hand-rolled rather than pulling a converter: the input surface is eight small tools we control, a
 * dependency in the agent hot path needs a written justification (doctrine §8), and an unsupported
 * type here should be a loud throw at load time rather than a silently-wrong schema at run time.
 */
export function jsonSchemaFor(params: ZodRawShape): { type: 'object'; properties: Record<string, unknown>; required?: string[] } {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, raw] of Object.entries(params)) {
    let node: ZodTypeAny = raw as ZodTypeAny;
    let optional = false;
    // unwrap ZodOptional / ZodDefault without reaching for instanceof (bundling can duplicate zod)
    for (;;) {
      const name = (node._def as { typeName?: string }).typeName;
      if (name === 'ZodOptional' || name === 'ZodDefault') {
        optional = true;
        node = (node._def as { innerType: ZodTypeAny }).innerType;
        continue;
      }
      break;
    }
    const description = (node._def as { description?: string }).description ?? (raw as ZodTypeAny).description;
    properties[key] = { ...primitive(node), ...(description ? { description } : {}) };
    if (!optional) required.push(key);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

export function primitive(node: ZodTypeAny): Record<string, unknown> {
  // optional/default wrappers reach here too, through an array's element type or an object's
  // field — unwrap before switching, or a `z.string().optional()` inside a row reads as unknown
  let inner: ZodTypeAny = node;
  for (;;) {
    const name = (inner._def as { typeName?: string }).typeName;
    if (name !== 'ZodOptional' && name !== 'ZodDefault') break;
    inner = (inner._def as { innerType: ZodTypeAny }).innerType;
  }
  const t = (inner._def as { typeName?: string }).typeName;
  switch (t) {
    case 'ZodString': return { type: 'string' };
    case 'ZodNumber': return { type: 'number' };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodEnum': return { type: 'string', enum: (inner._def as { values: string[] }).values };
    case 'ZodArray': return { type: 'array', items: primitive((inner._def as { type: ZodTypeAny }).type) };
    // a NESTED object (reply-radar: a target rides inside each reply row). Recursing through
    // jsonSchemaFor keeps one renderer for both levels, so required/description behave the same
    // however deep the shape goes — and the loud throw below still guards anything genuinely new.
    case 'ZodObject': return jsonSchemaFor((inner._def as { shape: () => ZodRawShape }).shape());
    default:
      throw new Error(`toolbus: jsonSchemaFor cannot express ${t ?? 'unknown zod type'} — add it or simplify the tool`);
  }
}
