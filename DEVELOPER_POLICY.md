# MetaDrive — Mandatory Developer Policy v2.0

**Vision:** One lightweight, universal, metadata-driven, no-code platform for building POS, ERP, CRM, DMS, KDS, Appointments, Bots and any future business software. Salesforce-inspired, without unnecessary complexity.

All rules apply to development, fixes, refactoring, migrations, installations, seeders and PRs.

## 1. Universal Lightweight Core
One shared Core: authentication, tenant isolation, central RBAC with the OneEngine permission set, metadata, generic CRUD, Component Renderer, Page Runtime, routing, Actions/Flows runtime, printing, communication, AppExchange and essential settings. No app-specific business logic.

## 2. Independent Applications
Every app must be independently installable, licensed, activated and uninstalled per tenant. Customers mix and match functionality without unnecessary dependencies.

## 3. Reuse First
Before creating Objects, Fields, Components, Actions, Flows, APIs or utilities, inspect and reuse existing capabilities. Extend shared engines before creating new ones. Prefer metadata loops and generic functions over duplicate code.

## 4. Fully Metadata-Driven
Objects, Fields, Relationships, Pages, layouts, Components, properties, events, navigation, permissions, Actions, Flows and business rules must use metadata. No hardcoded app-specific business behaviour in Core.

**Four layouts across all applications and Objects (global policy):** Every App Page and Object Record Page must expose **Mobile, Desktop, Tablet and Custom** layout variants, separately editable, versioned, published and assigned through the shared Page Builder and Page Runtime. The Custom layout supports an explicitly configured target/dimensions. All four reuse the same app/record/Flow identity, central RBAC and SQL metadata; no hardcoded per-app layout handling or backend copies. Existing layouts, published pages and user customisations must remain intact during additive rollout. Current Desktop/Tablet/Phone facilities must be extended to support a first-class Custom variant and independent layout selection before claiming compliance.

## 5. Universal Component Engine
One shared Registry, Renderer and property engine. Every independently editable element supports configurable layout, style, dimensions, responsiveness, visibility, validation, events and bindings. Avoid monolithic components.

## 6. Builders Separate From Runtime
Page, Dashboard, Report, Flow and other Builders load only when opened. Published apps run through lightweight shared runtimes without loading Builder code.

## 7. Lazy Loading
Load only required modules, routes and metadata. Uninstalled apps never initialise. Unopened optional apps must not burden startup or frontend memory. Use secure tenant-aware caching.

## 8. SQL Source of Truth
Store active metadata, settings, permissions, installations and business data in SQL. Store metadata and business records in relational SQL columns/tables only; do not store runtime state, metadata or records in JSON/JSONB files or columns.

## 9. Independent Seeders
Separate Core, shared dependency and per-app seeders. Include Objects, Fields, Components, properties, Pages, Flows, Actions, navigation and RBAC. Seeders must be versioned, idempotent, tenant-aware and upgrade-safe. Never duplicate metadata or overwrite user customisations.

## 10. Central RBAC and OneEngine Permission Set
One shared RBAC engine controls permissions for Objects, Fields, Records, Pages, Actions, Flows and administration. **OneEngine is a configurable permission set in RBAC, not the name of the RBAC engine.** It is assignable to authorised users like any other permission set. It can initially contain all applicable permissions, and administrators with appropriate RBAC authority can subsequently restrict or revoke individual grants. Users assigned OneEngine are still evaluated through the same central RBAC engine; no identity-based bypasses. Enforce access server-side, with explicit deny and revocation semantics. App installation, licence, entitlement and RBAC remain separate checks.

## 11. Developer Security Policies
Each tenant has a tenant-scoped `developer@tenant` identity. Provide a default **OneEngine** RBAC permission set that can be assigned to trusted tenant users and initially grants all applicable tenant-level administrative permissions during setup/installation. These grants must remain individually configurable and revocable through RBAC; the developer identity must not itself confer permissions. Assignments, not user names or email addresses, determine access. Platform administration uses separately scoped RBAC permission sets (for example, **Platform Developer**) assigned to authorised platform identities such as `support@unesolutions.co.uk`. Platform permissions never imply unrestricted access to tenant business data: that requires explicit, audited authorisation. No email-based bypass, shared passwords or cross-tenant access.

## 12. AppExchange Lifecycle
Centralise discovery, dependency checks, licensing, install, seeding, RBAC, activation, updates, migrations, deactivation, uninstall and reinstall. Uninstall disables app-specific routes, Flows, jobs and modules. Preserve shared dependencies and tenant business records.

## 13. Generic CRUD
All apps use shared Object APIs for CRUD, filtering, queries, relationships, validation and pagination. Enforce tenant, Record, Object and Field permissions. No duplicate CRUD engines.

## 14. Universal Data Loader
One import/export engine supporting field mapping, preview, validation, bulk operations, errors, retries and applicable rollback. Enforce central RBAC, including effective OneEngine and Field permissions.

## 15. Shared Action/Flow Engine
Use metadata-driven Flows for CRUD, decisions, loops, formulas, HTTP, printing, communication and scheduling. No parallel workflow engines. Enforce permissions and app activation. Support durable execution and failure handling.

## 16. Generic Integrations
Use reusable HTTP callouts, webhooks, messaging, printing and connectors. Secure credentials, validate external requests, enforce permissions and log failures. No app-specific integration logic in Core.

## 17. No-Code First
Non-developers must configure Objects, Pages, Flows, business rules and HTTP calls using understandable visual tools. Ordinary supported tasks must not require JavaScript, SQL or JSON.

## 18. Versioning and Publishing
Support metadata draft/publish, version history, migrations and rollback where applicable. App updates preserve customer customisations and must not silently break published functionality.

## 19. Security and Auditing
Enforce tenant isolation across APIs, SQL, caching, Flows and jobs. Audit privileged operations, installations, policy changes and support access. Protect credentials and sensitive data. RBAC alone is not complete security.

## 20. Data Recovery
Seeders must rebuild platform metadata and fresh tenants. Business records require separate SQL backups. Migrations, cleanup and uninstall must not silently delete customer data or customisations.

## 21. Modular Code Limits
Separate Core, shared runtimes, Builders, Apps, seeders and services. New/extracted files: maximum 4,000 lines. Architectural ceiling: 4,200 lines. Oversized legacy files are temporary exceptions; prevent growth and progressively split.

## 22. Development Execution
Inspect existing architecture, reuse shared engines, implement the complete approved scope, update SQL/seeders, enforce RBAC, test and fix defects. Prefer one consolidated PR. Avoid repeated audits and partial work. Pause only for genuine blockers or unresolved owner decisions.

## 23. Mandatory Validation
Verify Core without optional apps, tenant licensing/RBAC, lazy loading, SQL seeder idempotency, component reuse, app lifecycle, Flow activation/deactivation, data preservation, security, performance, builds, tests and CI. Never claim completion without evidence.

## 24. Policy Enforcement
All developers and AI agents must follow these rules. Repository `DEVELOPER_POLICY.md` is authoritative; `AGENTS.md`, Copilot instructions and CI must remain consistent. Escalate conflicting requirements before implementation. Never silently bypass rules.

## Permanent Principles

**ONE CORE · ONE CENTRAL RBAC ENGINE · ONEENGINE PERMISSION SET · ONE METADATA PLATFORM · REUSABLE COMPONENTS · SQL SOURCE OF TRUTH · INDEPENDENT APP SEEDERS · TENANT APP INSTALLATION · LAZY LOADING · NO-CODE FIRST**

Every feature must satisfy:
1. Can a non-developer configure it?
2. Can other applications reuse it?
3. Can tenants operate without loading it when unnecessary?

**Priority:** Complete Core cleanup, modularisation, SQL metadata, seeders and shared-engine validation before building new apps.

**Working style:** Short updates: Done / Pending / Blocker. Complete approved tasks without unnecessary pauses. Never report unverified work as complete.
