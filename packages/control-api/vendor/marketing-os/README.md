# Vendored: marketing-os

Source: https://github.com/Yuzzyuk/marketing-os (MIT — LICENSE alongside)
Vendored 2026-08-20 at upstream `bb67dff5f04b390e861ee11433166e4519e7f4c0` (v1.1).
Author: Yuzzy Itaba.

These files are **byte-verbatim upstream** — the router (`SKILL.md`), the fourteen reference
modules, and the brand-context template. Do not edit them here; re-vendor to update
(`git clone`, copy, bump this header). The NeuraMesh adaptations live OUTSIDE these files:
`scripts/gen-marketing-os-seed.ts` composes each bundled skill from a NeuraMesh preamble
(brand docs instead of brand-context.md, artifacts instead of loose files, legs instead of
subagents, the report shape contract) plus the verbatim module text, and emits
`src/seed/marketing-os-skill-seed.ts` (generated — never edit by hand).

Design round: docs/design/marketing-os-2026-08/plan.md.
