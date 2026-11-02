# LearnSphere

LearnSphere is a full-stack learning management system focused on organization-scoped course authoring and learning. The current implementation includes account sessions and MFA, organizations and memberships, course discovery and authoring, enrollment, lesson delivery, and learner progress.

## Features

- Cookie-based sessions with CSRF and Origin protection, session expiry, MFA, and account recovery foundations.
- Organization membership and permission checks with tenant-scoped course management.
- Instructor course and lesson authoring, publishing, and archiving.
- Course discovery, enrollment, protected lesson content, and progress tracking.
- API and frontend tests, including isolated MongoDB replica-set integration tests.

Paid courses, payments, certificates, video hosting, assessments, cohorts, live classes, jobs, and advanced analytics are not implemented.

## Technology

TypeScript, React, Vite, Redux Toolkit Query, Node.js, Express, MongoDB/Mongoose, Zod, and npm workspaces.

## Repository layout

- `apps/api` — Express API, MongoDB models, authorization, and API tests.
- `apps/web` — React application and frontend tests.
- `packages/shared` — shared TypeScript package.
- `docs/architecture` — product, architecture, API, data, and UI documentation.
- `docs/security` — identity and session security notes.

## Requirements

- Node.js 20 or newer and npm.
- MongoDB 4.2 or newer on a writable replica set. Transactions are used by the API.

## Local setup

1. Install dependencies from the repository root:

   ```sh
   npm ci
   ```

2. Copy `.env.example` to `apps/api/.env` and set `MONGODB_URI` to your local replica-set database. Generate a unique MFA key:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Put the generated value in `MFA_ENCRYPTION_KEY`. The example file contains placeholders and development defaults only. Never use its key placeholder as a real key.

3. Start the API and web app:

   ```sh
   npm run dev
   ```

   The API listens on port 4000 and the Vite app on port 5173 by default. To override the browser API endpoint, create `apps/web/.env.local` with `VITE_API_BASE_URL=http://localhost:4000/api/v1`.

## Commands

Run from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run API and web development servers |
| `npm run build` | Build shared package, web app, and API |
| `npm run typecheck` | Typecheck shared package, API, and web app |
| `npm test` | Run API unit and HTTP tests |
| `npm run test:integration` | Run API integration tests against an isolated local replica set |
| `npm run test --workspace @lms/web` | Run frontend tests |

Integration tests require `LMS_INTEGRATION_MONGODB_URI` pointing to a loopback MongoDB replica set and the dedicated `learnsphere_phase2_test` database. Tests use scoped fixture records and do not drop the database or collections. See the API package and CI workflow for details.

## Implementation status

The implemented workflow is organization-scoped course authoring and learner progress, supported by identity, session, membership, and authorization foundations. Architecture documents also describe planned capabilities; their future-state proposals should not be read as implemented features. Production deployment, external email delivery, payment processing, and media hosting are not configured by this repository.
