# Spotter

Spotter puts a high school player's card on screen the moment the announcer says their surname or a cued jersey number. It listens through Deepgram, matches against two saved rosters, and reads rosters and season stats from whatever file the announcer has (PDF, screenshot, pasted text, CSV or Excel) with Claude.

This repository is Spotter V3 rebuilt on the class stack: Next.js on Railway, Railway Postgres, and Google sign-in. The product spec is [`docs/V3_DEFINITION.md`](docs/V3_DEFINITION.md); the architecture is [`docs/technical-design.md`](docs/technical-design.md).

## Run it locally

Requires Node 22 and a local Postgres (from `security/db-auth` on).

```bash
cp .env.example .env.local   # fill in values; never commit it
npm install
npm run dev
```

## Checks

```bash
npm run check   # typecheck, lint, tests
npm run build
```

CI runs the same on every push to `main` and `staging` and on every pull request, plus `npm audit`.

## Branches and deploys

- `staging` takes direct pushes and pull requests. Railway's `staging` environment deploys it, with its own database and keys.
- `main` is production. It changes only by a tested `staging` → `main` merge commit.
- Each change set is its own short-lived branch off `staging`.

Railway's setup is code in `.railway/railway.ts`. With the project linked (`railway link -p spotter -w BCIL -e <environment>`), `railway config plan` previews a change and `railway config apply` makes it, once per environment.

Backups, restore and rollback steps arrive with `ops/launch`.

## License

Spotter is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
Copyright 2026 The Spotter founders.

- **Noncommercial use is free.** Personal study, learning, hobby projects, schools, and nonprofits may
  use, copy, modify, and share the code, as long as they include the license and its `Required Notice:` line.
- **Commercial use is reserved to the founders,** who keep all rights to the code and the product. To ask
  about commercial use, open an issue on this repository.
- Third-party libraries and assets keep their own licenses.
