import { spawn } from "node:child_process";

const fail = (message) => {
  console.error(`Container configuration error: ${message}`);
  process.exit(1);
};

if (process.env.NODE_ENV !== "production") {
  fail("NODE_ENV must be production.");
}

if (
  !["local", "preview", "production"].includes(process.env.NEXT_PUBLIC_APP_ENV)
) {
  fail("NEXT_PUBLIC_APP_ENV must be local, preview, or production.");
}

if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL is required.");
}

try {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    fail("DATABASE_URL must use the PostgreSQL protocol.");
  }
} catch {
  fail("DATABASE_URL must be a valid PostgreSQL URL.");
}

if (
  !process.env.REQUIRED_DATABASE_MIGRATION ||
  !/^\d{14}_[a-z0-9_]+$/.test(process.env.REQUIRED_DATABASE_MIGRATION)
) {
  fail("REQUIRED_DATABASE_MIGRATION must name the required schema migration.");
}

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  fail("PORT must be an integer from 1 through 65535.");
}

console.log(`Starting Baseball Stat Track on port ${port}.`);

const server = spawn(process.execPath, ["server.js"], {
  env: process.env,
  stdio: "inherit",
});

let shutdownSignal;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdownSignal = signal;
    if (!server.killed) {
      server.kill(signal);
    }
  });
}

server.once("error", () => {
  console.error("Application server failed to start.");
  process.exit(1);
});

server.once("exit", (code, signal) => {
  if (shutdownSignal) {
    process.exit(0);
  }

  if (signal) {
    console.error(`Application server stopped after signal ${signal}.`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
