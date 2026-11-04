// Bare Git references can look exactly like CSS colors (#235) or local task numbers (#1234).
const gitLabel = /\b(?:PRs?|pull[ -]requests?|issues?)\b[\s*_~:(]*(?:#\d+[\s,/&]+(?:(?:and|or)\s+)?)*$/i;
const qualifiedRepo = /(?:^|[^\w./-])[\w.-]+\/[\w.-]+$/;

export const followsGitReference = (prefix: string) => gitLabel.test(prefix) || qualifiedRepo.test(prefix);

type InlineNode = {
  type: string;
  value?: string;
  children?: InlineNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

function visibleText(node: InlineNode): string {
  return node.value ?? node.children?.map(visibleText).join('') ?? '';
}

/** Keep reference numbers out of the palette renderer while preserving their original typography.
 * Inspect parsed inline text so emphasis around “PR” or code around its number doesn't change its meaning. */
export function remarkGitReferences() {
  function visit(node: InlineNode) {
    if (node.type !== 'paragraph' && node.type !== 'tableCell') {
      node.children?.forEach(visit);
      return;
    }
    let prefix = '';
    function mark(parent: InlineNode) {
      if (!parent.children) return;
      parent.children = parent.children.flatMap((child): InlineNode | InlineNode[] => {
        if (child.type === 'link' || child.type === 'linkReference') {
          prefix += visibleText(child);
          return child;
        }
        if (child.children) { mark(child); return child; }
        const before = prefix;
        prefix += child.value ?? ' ';
        if (child.type === 'inlineCode' && /^#(?:\d{3}|\d{6})$/.test(child.value ?? '') && followsGitReference(before)) {
          return { ...child, data: { ...child.data, hProperties: { ...child.data?.hProperties, className: 'gitref' } } };
        }
        if (child.type !== 'text' || !child.value?.includes('#')) return child;
        const parts: InlineNode[] = [];
        let end = 0;
        for (const match of child.value.matchAll(/#(?:\d{6}|\d{3})\b/g)) {
          if (!followsGitReference(before + child.value.slice(0, match.index))) continue;
          if (match.index > end) parts.push({ type: 'text', value: child.value.slice(end, match.index) });
          parts.push({ type: 'text', value: match[0], data: { hName: 'span' } });
          end = match.index + match[0].length;
        }
        if (!end) return child;
        if (end < child.value.length) parts.push({ type: 'text', value: child.value.slice(end) });
        return parts;
      });
    }
    mark(node);
  }
  return (tree: InlineNode, file: { value: unknown }) => {
    if (typeof file.value === 'string' && /#(?:\d{3}|\d{6})\b/.test(file.value)) visit(tree);
  };
}
