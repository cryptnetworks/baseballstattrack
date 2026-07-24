# ADR 0001: Initial Web Application Stack

## Status

Accepted

## Context

Baseball Stat Track needs touch-friendly scorekeeping, replayable source events, relational reporting, operational simplicity, and a path to future mobile support. The approved direction is Next.js App Router, React, strict TypeScript, Tailwind CSS, PostgreSQL, Supabase, Prisma, TanStack Query, Zod, TypeScript tests, and GitHub Actions.

## Decision

Use a Next.js App Router application with React and strict TypeScript as the primary web platform. Use Tailwind CSS for UI styling, Zod for boundary validation, TanStack Query for client/server data synchronization, PostgreSQL hosted through Supabase for relational persistence, Prisma ORM for typed database access and migrations, Vitest for focused TypeScript tests, and GitHub Actions for CI.

Supported local runtime:

- Node.js 24 or newer
- npm 11 or newer

## Options Compared

- Next.js App Router: best fit for server-rendered application pages, typed routes, server-side services, and a future hosted web deployment.
- Vite SPA: simpler client app, but would push routing, API, and server boundaries into separate choices sooner.
- Remix: strong web fundamentals, but less aligned with the approved stack and common Vercel/Supabase deployment path.
- PostgreSQL/Supabase: strong relational reporting and managed auth/storage path. Local Supabase can support later integration testing.
- Document or aggregate-stat-first storage: rejected because game events must remain the source of truth and derived statistics must be recalculable.

## Consequences

The repository starts as a full-stack TypeScript application with explicit boundaries for UI, domain logic, validation, data access, and server application services. Product domain rules must remain independent from React, Next.js, Supabase, and Prisma so event replay and stat derivation can be tested deterministically.
