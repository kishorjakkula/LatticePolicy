---
title: Platform currency
last_reviewed: 2026-10-17
review_every_days: 30
sources: package.json files, .github/workflows/ci.yml, docker-compose files; check each project's official release and end-of-life pages when refreshing
---

# Platform Currency

Versions in use at the last review. On refresh, compare with each project's
official release notes and end-of-life schedule and open issues for upgrades.

| Platform | In use | Where declared |
| --- | --- | --- |
| Node.js | 22 in CI; engines `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | `package.json`, `.github/workflows/ci.yml` |
| PostgreSQL | 15 | `docker-compose.yml`, CI service, carrier stack |
| Redis | 7 | `docker-compose.yml`, carrier stack |
| TypeScript | ^7.0 | `server/package.json`, `frontend/package.json` |
| Express | ^5.3 | `server/package.json` |
| Drizzle ORM | ^1.0.0-rc | `server/package.json` (release candidate — track to stable) |
| Zod | ^4.6 | `server/package.json` |
| React | ^19.3 | `frontend/package.json` |
| Vite | ^8.3 | `frontend/package.json` |
| TanStack Query | ^5.104 | `frontend/package.json` |
| React Router | ^7.18 | `frontend/package.json` |
| Vitest | 5.0.5 | server and frontend |
| Playwright | ^1.64 | root `package.json` |
| Puppeteer | ^24.43 | `server/package.json` (PDF generation; brings `extract-zip`, see open advisories) |

## Known follow-ups

- PostgreSQL 15 is supported until November 2027; plan the move to a newer major.
- Open Dependabot advisories for `extract-zip` through Puppeteer (October 2026).
