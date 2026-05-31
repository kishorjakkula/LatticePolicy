# LatticePolicy

LatticePolicy is an open-source starter framework for building multi-tenant policy administration systems. It includes a policy API, operations UI, customer portal views, product and tenant extension points, Docker-based local deployment, and documentation for architecture, APIs, and deployment.

The core design is a single policy platform with access-based experiences. Internal users, agents, underwriters, administrators, and end customers all enter through the same framework, but see different navigation, routes, APIs, and data projections based on tenant, role, permissions, and customer-policy relationships.

The current implementation focuses on carrier-extensible insurance workflows:

- Multi-tenant policy lifecycle APIs
- Quote, bind, endorse, cancel, reinstate, and renew workflows
- Product packs and tenant configuration
- Unified internal operations and customer portal architecture
- PostgreSQL persistence and Redis-backed cache
- Docker Compose local deployment
- CI and AWS ECS deployment examples

## Unified Access-Based Architecture

LatticePolicy intentionally avoids building the internal policy system and the customer portal as unrelated applications. Instead, it uses one platform architecture with different role-scoped experiences on top of the same domain model, policy lifecycle, document service, tenant model, and security boundary.

This matters for insurance systems because the same policy data is used by many audiences:

- Administrators manage tenant configuration, users, products, forms, and security.
- Underwriters review submissions, referrals, rating details, and transaction history.
- Agents create quotes, bind policies, service endorsements, and search customer/policy records.
- Actuarial or product users manage rating inputs and product behavior.
- Customers view only their own issued policies, customer-safe summaries, declarations, and ID cards.

The framework keeps those experiences consistent while enforcing different access levels.

### One Frontend Shell, Many Experiences

The `frontend/` app is a single React application shell. It renders different routes and navigation based on the authenticated user context.

Internal users may see operational routes such as:

- Dashboard
- Search
- Quote wizard
- Policy view
- Underwriting queue
- Rating workbench
- Administration
- Tenant configuration
- User/security management

Customer users may see only portal-safe routes such as:

- My policies
- Policy summary
- Declarations
- ID cards

The shell is shared, but the route tree is permission-gated. A customer role should not merely have hidden navigation; customer routes and backend APIs are also scoped so a customer cannot fetch internal policy records, rating worksheets, admin data, or other customers' policies.

### Access Model

The access model combines several checks:

- Tenant scope: every request is resolved inside a tenant boundary.
- Role-based access control: user roles determine broad capabilities such as admin, underwriter, agent, actuary, or customer.
- Permission-gated routes: frontend routes and navigation items are derived from the user's allowed capabilities.
- API authorization: backend handlers enforce the same access rules independently of the UI.
- Customer identity links: customer portal access is constrained through the relationship between `users.customer_id`, `customers`, and `policy_customer_links`.
- Portal-safe projections: customer-facing APIs return reduced views of policy data instead of internal operational records.

This means the customer portal is not a separate data silo. It is a restricted view over the same policy system.

### Shared Domain, Different Projections

Internal and customer experiences use the same underlying policy lifecycle, but not the same response shape.

Internal views can include operational details such as:

- Quote and transaction status
- Underwriting referral reasons
- Rating inputs and calculation traces
- Policy timeline and endorsement history
- Admin metadata
- Tenant/product configuration
- Form and document management details

Customer portal views should expose only what a policyholder needs:

- Policy number
- Product/line of business
- Current term dates
- Current premium summary
- Covered vehicles or insured risk summary
- Selected limits and deductibles
- Customer-facing declaration documents
- ID cards for eligible products

The backend supports this by providing portal-specific endpoints, such as customer summary and customer policy detail routes, that enforce linked-customer scope and return customer-safe data.

### Why This Architecture

This architecture is useful for open-source PAS adoption because it gives implementers one extensible platform instead of multiple disconnected systems.

Benefits:

- Lower duplication: policy lifecycle, documents, tenant configuration, and product behavior are reused.
- Stronger consistency: portal users and internal users see different views of the same source of truth.
- Cleaner security model: customer access is a first-class capability, not an afterthought bolted onto admin APIs.
- Easier carrier customization: tenant and product extensions affect the full platform consistently.
- Better auditability: transactions, documents, and derived portal views remain tied to the same policy timeline.
- Simpler deployment: one policy API and one frontend shell can support multiple user experiences.

### Design Principle

The framework should treat "portal" as an access pattern, not a separate product. A portal user is a user with a constrained identity link, constrained permissions, constrained routes, and constrained data projections over the shared policy administration domain.

## Repository Layout

```text
contracts/        Request/response schemas and contracts
docs/             Architecture, API, domain, and deployment notes
frontend/         Policy operations/customer React UI
packages/types/   Shared type package
products/         Product pack definitions and rating inputs
server/           Policy API server
tenants/          Sample tenant configuration and overrides
nginx/            Production reverse proxy configuration
observability/    Optional monitoring stack configuration
```

## Quick Start

Prerequisites:

- Docker Desktop
- Node.js 20+ and npm, if running outside Docker

Start the full local stack:

```bash
cp .env.example .env
docker compose up -d --build
```

Default local URLs:

- Policy UI: http://localhost:5173
- Policy API health: http://localhost:3300/health
- PostgreSQL: localhost:65432
- Redis: localhost:6379

Stop the stack:

```bash
docker compose down
```

## Development

Install workspace dependencies:

```bash
npm install
```

Run checks:

```bash
npm run build
npm run test
npm run typecheck
```

Run individual apps:

```bash
npm run dev:server
npm run dev:frontend
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Domain model](docs/DOMAIN.md)
- [Multitenancy](docs/MULTITENANCY.md)
- [Data model ERD](docs/DATA_MODEL_ERD.md)
- [AWS GitHub Actions deployment](docs/GITHUB_ACTIONS_AWS.md)
- [Open-source readiness](docs/OPEN_SOURCE_READINESS.md)

## Extension Points

The framework is intended to be extended through product packs, tenant configuration, and service adapters. The existing sample tenant and product folders are the best starting point:

- `products/`
- `tenants/sample-carrier/`
- `server/src/`
- `contracts/`

## Security

Do not commit secrets. Copy `.env.example` to `.env` for local development and set real values outside source control.

Report security issues using the process in [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, standards, and pull request guidance.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
