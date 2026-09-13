"""Find one-way seams inside a file: partition its functions so that edges cross in one direction.

    python3 scripts/find-seams.py <file.ts> [more.ts ...]


The wake.ts test. Counting bindings at a boundary says how tangled a CUT is; this says whether a
cut exists at all. A group that nothing calls back into can leave whichever way the arrows point.

Written after claiming wake.ts was unsplittable on a boundary count (43 dependencies) without
ever looking inside it. It had a clean one-way seam — routing calls the runner, the runner never
calls back — and splitting it took the file from 479 lines to 310.

READ THE OUTPUT, DO NOT TRUST IT. The search reports any group with no inbound edges, and a set
of functions that simply are not called from within their own file satisfies that trivially. A
real seam also has to be a CONCEPT: 'who answers' vs 'run the turn' is one; 'six leftover
exports' is not. The tool narrows the candidates; a human decides which is a boundary.
"""
import re, sys, itertools

def funcs(path):
    L = open(path).read().split('\n')
    out = {}
    for i, l in enumerate(L):
        m = (re.match(r'^  (?:async )?function (\w+)\s*\(', l)
             or re.match(r'^  const (\w+)\s*=\s*(?:async )?\(', l)
             or re.match(r'^(?:export )?(?:async )?function (\w+)\s*\(', l)
             or re.match(r'^(?:export )?const (\w+)\s*=\s*(?:async )?\(', l))
        if not m: continue
        p = 0; sig = i
        for j in range(i, len(L)):                       # signature ends when PARENS balance
            p += L[j].count('(') - L[j].count(')')
            if p == 0 and '(' in ''.join(L[i:j + 1]): sig = j; break
        d = 0
        for j in range(sig, len(L)):                     # then the body, by braces
            d += L[j].count('{') - L[j].count('}')
            if d == 0 and j > sig: out[m.group(1)] = (i, j); break
    return L, out

def graph(L, fns):
    g = {n: set() for n in fns}
    for n, (s, e) in fns.items():
        body = '\n'.join(L[s:e + 1])
        for other in fns:
            if other != n and re.search(r'(?<![\w.])' + other + r'\s*\(', body): g[n].add(other)
    return g

for path in sys.argv[1:]:
    L, fns = funcs(path)
    big = {n: v for n, v in fns.items() if v[1] - v[0] + 1 >= 12}
    # A group containing the CONTAINER is the whole file, not a partition — drop any function
    # whose span encloses another's. (First version reported "3,926L, nothing calls in" for
    # App.tsx, which is true and useless.)
    encl = {n for n, (s0, e0) in big.items() if any(m != n and s0 < s1 and e1 < e0 for m, (s1, e1) in big.items())}
    big = {n: v for n, v in big.items() if n not in encl}
    if len(big) < 2:
        print(f'\n{path.split("/")[-1]:22} {len(fns)} fns, {len(big)} ≥12 lines — no partition to test')
        continue
    g = graph(L, big)
    print(f'\n{path.split("/")[-1]:22} {len(big)} nested functions ≥12 lines ({len(encl)} containers excluded)')
    # every function whose callers are all outside a candidate group == a leaf cluster
    best = []
    names = sorted(big, key=lambda n: -(big[n][1] - big[n][0]))
    for r in range(1, min(len(names), 6) + 1):
        for combo in itertools.combinations(names, r):
            cs = set(combo)
            out_edges = {(a, b) for a in cs for b in g[a] if b not in cs}
            in_edges = {(a, b) for a in g for b in g[a] if b in cs and a not in cs}
            if not in_edges and out_edges is not None:
                lines = sum(big[n][1] - big[n][0] + 1 for n in cs)
                if lines >= 60: best.append((lines, cs, len(out_edges)))
    best.sort(reverse=True)
    seen = set()
    for lines, cs, oe in best[:4]:
        key = frozenset(cs)
        if any(key <= s for s in seen): continue
        seen.add(key)
        print(f'   {lines:4}L  nothing calls in · {oe} calls out · {", ".join(sorted(cs))}')
    if not best: print('    no group ≥80L that nothing calls back into')
