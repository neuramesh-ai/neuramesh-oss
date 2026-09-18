# How to contribute

Thank you for your interest in NeuraMesh.

## Issues

Issues are welcome. Report a bug with the app version, the steps to reproduce it, and what you expected. Questions and ideas are issues too.

## Pull requests

Open an issue before you write a feature. A small team maintains this repository. A pull request may wait, and it may not be reviewed. A fix for a bug with an open issue has the best chance.

Use the pull request template: What & why, Evidence, Deploy notes. A check fails a pull request when a section is missing or empty, and runs again when you edit the text.

This repository is published from a private one that holds the hosted service too. A pull request that is accepted here is ported into that repository by a maintainer, and it reaches this repository with the next publish. Your commit message and your name travel with it. How the publish works, with diagrams: [docs/43-public-repository.md](docs/43-public-repository.md).

Match the code around your change. The doctrine the codebase follows is in [CLAUDE.md](CLAUDE.md) and [docs/05-engineering-philosophy.md](docs/05-engineering-philosophy.md). Every word a person reads follows ASD-STE100: short sentences, active voice, simple tenses, no em dashes, no semicolons.

## Run the checks

You need Node 22 or later, pnpm 10 (`corepack enable`), and Docker for the database checks.

```bash
corepack pnpm install --frozen-lockfile
pnpm check                      # typecheck, lint, tests
pnpm db:validate                # migrations on a throwaway Postgres in Docker
bash scripts/public-scan.sh     # the public-repo gate, needs gitleaks
```

## License

Your contribution is licensed under the [Elastic License 2.0](LICENSE), the license of this repository.
