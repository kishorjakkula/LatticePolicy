---
title: Delivery knowledge base
last_reviewed: 2026-10-17
review_every_days: 180
sources: this repository
---

# Delivery Knowledge Base

The delivery agents ([`agents/`](../../agents/README.md)) read this folder to
work with current domain and engineering knowledge. AI models do not learn
between sessions; what the agents know beyond their training is what is kept
here, reviewed by people.

| Area | Start here | Used by |
| --- | --- | --- |
| P&C insurance | [`pc-insurance/README.md`](pc-insurance/README.md) | Business analyst, test designer, business validation, security and compliance |
| Architecture and engineering | [`architecture/README.md`](architecture/README.md) | Software architect, developer, code reviewer, deployment |
| LatticePolicy itself | [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) and the docs it links | Every agent |

## File rules

Every knowledge file starts with:

```yaml
---
title: Short title
last_reviewed: YYYY-MM-DD
review_every_days: 90
sources: where the facts come from
---
```

- Every fact that can change (a regulation, a market figure, a version) has a
  source link.
- An agent that reads a file past `last_reviewed + review_every_days` says so
  and treats its time-sensitive facts as needing confirmation.
- `npm run knowledge:report` lists files due for review. The monthly
  `knowledge-refresh` workflow opens an issue for them; the knowledge curator
  proposes updates in a pull request that a person reviews and merges.

## Allowed sources for refreshes

Prefer primary sources: state insurance department bulletins and statutes, NAIC
(model laws, SERFF, market regulation), ISO/Verisk and AAIS public notices,
ACORD standards, CAS and NCCI publications, AM Best, federal sources (FIO,
NRRA), and for engineering the official release notes and security advisories
of the platforms in use (Node.js, PostgreSQL, React, Vite, Playwright, npm
advisories, GitHub advisories, OWASP, NIST). Secondary sources (trade press,
vendor blogs) may support a fact but are labelled as such.
