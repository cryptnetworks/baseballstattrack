import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specificationPath = "docs/api/statistics-v1.openapi.yaml";
const lockPath = resolve(root, "docs/api/statistics-v1.compatibility.json");
const expectedOperations = new Map([
  ["listAccountsV1", "/api/v1/accounts"],
  ["getAccountV1", "/api/v1/accounts/{accountId}"],
  ["listTeamsV1", "/api/v1/accounts/{accountId}/teams"],
  ["listSeasonsV1", "/api/v1/accounts/{accountId}/seasons"],
  ["listPlayersV1", "/api/v1/accounts/{accountId}/players"],
  ["listGamesV1", "/api/v1/accounts/{accountId}/games"],
  ["getBoxScoreV1", "/api/v1/accounts/{accountId}/games/{gameId}/box-score"],
  [
    "getSeasonReportV1",
    "/api/v1/accounts/{accountId}/seasons/{seasonId}/leaders",
  ],
]);
const methods = new Set([
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "options",
  "head",
  "trace",
]);
const forbiddenFields = new Set([
  "internalId",
  "membershipId",
  "providerSubject",
  "readySetupSnapshotId",
  "rulesetVersionId",
  "setupSnapshotId",
]);

function fail(message) {
  throw new Error(`Statistics API contract: ${message}`);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

function serialized(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function digest(document) {
  return createHash("sha256").update(serialized(document)).digest("hex");
}

function resolveLocalReference(document, reference) {
  if (!reference?.startsWith("#/")) fail(`unsupported reference ${reference}`);
  return reference
    .slice(2)
    .split("/")
    .reduce(
      (value, part) =>
        value?.[part.replaceAll("~1", "/").replaceAll("~0", "~")],
      document,
    );
}

function dereference(document, value) {
  if (!value?.$ref) return value;
  const resolved = resolveLocalReference(document, value.$ref);
  if (!resolved) fail(`unresolved reference ${value.$ref}`);
  return resolved;
}

function types(schema) {
  const value = schema?.type;
  return new Set(
    value === undefined ? [] : Array.isArray(value) ? value : [value],
  );
}

function validateValue(document, rawSchema, value, location) {
  const schema = dereference(document, rawSchema);
  if (!schema) fail(`${location} has no schema`);
  if (schema.allOf) {
    for (const child of schema.allOf)
      validateValue(document, child, value, location);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((child) => {
      try {
        validateValue(document, child, value, location);
        return true;
      } catch {
        return false;
      }
    });
    if (matches.length !== 1)
      fail(`${location} must match exactly one oneOf branch`);
    return;
  }
  if (schema.const !== undefined && value !== schema.const) {
    fail(`${location} must equal ${JSON.stringify(schema.const)}`);
  }
  if (
    schema.enum &&
    !schema.enum.some((candidate) => Object.is(candidate, value))
  ) {
    fail(`${location} is not an allowed enum value`);
  }
  const allowedTypes = types(schema);
  const actualType =
    value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : Number.isInteger(value)
          ? "integer"
          : typeof value;
  if (
    allowedTypes.size > 0 &&
    !allowedTypes.has(actualType) &&
    !(actualType === "integer" && allowedTypes.has("number"))
  ) {
    fail(
      `${location} must be ${[...allowedTypes].join(" or ")}, received ${actualType}`,
    );
  }
  if (value === null) return;
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      fail(`${location} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      fail(`${location} is too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      fail(`${location} does not match ${schema.pattern}`);
    if (
      schema.format === "uuid" &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      fail(`${location} is not a UUID`);
    if (
      (schema.format === "date" || schema.format === "date-time") &&
      Number.isNaN(Date.parse(value))
    )
      fail(`${location} is not a valid ${schema.format}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      fail(`${location} is below its minimum`);
    if (schema.maximum !== undefined && value > schema.maximum)
      fail(`${location} exceeds its maximum`);
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries())
      validateValue(document, schema.items, child, `${location}[${index}]`);
    return;
  }
  if (typeof value === "object") {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) fail(`${location}.${key} is required`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key])
        validateValue(document, properties[key], child, `${location}.${key}`);
      else if (schema.additionalProperties === false)
        fail(`${location}.${key} is not declared`);
      else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      ) {
        validateValue(
          document,
          schema.additionalProperties,
          child,
          `${location}.${key}`,
        );
      }
    }
  }
}

function operationParameters(document, operation) {
  return new Map(
    (operation.parameters ?? []).map((raw) => {
      const parameter = dereference(document, raw);
      return [`${parameter.in}:${parameter.name}`, parameter];
    }),
  );
}

function compatibleSchema(
  baselineDocument,
  baselineRaw,
  currentDocument,
  currentRaw,
  location,
  seen = new Set(),
) {
  const baseline = dereference(baselineDocument, baselineRaw);
  const current = dereference(currentDocument, currentRaw);
  if (!current) fail(`${location} was removed`);
  const pair = `${location}:${baselineRaw?.$ref ?? "inline"}:${currentRaw?.$ref ?? "inline"}`;
  if (seen.has(pair)) return;
  seen.add(pair);
  if (baseline.const !== undefined && current.const !== baseline.const)
    fail(`${location} changed its constant`);
  if (baseline.enum) {
    if (
      !current.enum ||
      baseline.enum.some(
        (value) =>
          !current.enum.some((candidate) => Object.is(candidate, value)),
      )
    ) {
      fail(`${location} narrowed its enum`);
    }
  }
  const baselineTypes = types(baseline);
  const currentTypes = types(current);
  if (
    baselineTypes.size &&
    [...baselineTypes].some((type) => !currentTypes.has(type))
  )
    fail(`${location} narrowed its type`);
  for (const keyword of [
    "format",
    "pattern",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
  ]) {
    if (
      baseline[keyword] !== undefined &&
      current[keyword] !== baseline[keyword]
    )
      fail(`${location} changed ${keyword}`);
  }
  for (const key of baseline.required ?? []) {
    if (!(current.required ?? []).includes(key))
      fail(`${location}.${key} is no longer guaranteed`);
  }
  for (const [key, child] of Object.entries(baseline.properties ?? {})) {
    compatibleSchema(
      baselineDocument,
      child,
      currentDocument,
      current.properties?.[key],
      `${location}.${key}`,
      seen,
    );
  }
  if (baseline.items)
    compatibleSchema(
      baselineDocument,
      baseline.items,
      currentDocument,
      current.items,
      `${location}[]`,
      seen,
    );
  if (baseline.allOf) {
    if (!current.allOf || current.allOf.length < baseline.allOf.length)
      fail(`${location} removed an allOf constraint`);
    baseline.allOf.forEach((child, index) =>
      compatibleSchema(
        baselineDocument,
        child,
        currentDocument,
        current.allOf[index],
        `${location}.allOf[${index}]`,
        seen,
      ),
    );
  }
  if (baseline.oneOf) {
    if (!current.oneOf || current.oneOf.length < baseline.oneOf.length)
      fail(`${location} removed a oneOf alternative`);
    baseline.oneOf.forEach((child, index) =>
      compatibleSchema(
        baselineDocument,
        child,
        currentDocument,
        current.oneOf[index],
        `${location}.oneOf[${index}]`,
        seen,
      ),
    );
  }
}

function assertCompatible(baseline, current, label) {
  for (const [path, baselinePath] of Object.entries(baseline.paths ?? {})) {
    const currentPath = current.paths?.[path];
    if (!currentPath) fail(`${label} removed path ${path}`);
    for (const [method, baselineOperation] of Object.entries(baselinePath)) {
      if (!methods.has(method)) continue;
      const currentOperation = currentPath[method];
      if (!currentOperation)
        fail(`${label} removed ${method.toUpperCase()} ${path}`);
      for (const status of Object.keys(baselineOperation.responses ?? {})) {
        if (!currentOperation.responses?.[status])
          fail(
            `${label} removed ${method.toUpperCase()} ${path} response ${status}`,
          );
        const baselineResponse = dereference(
          baseline,
          baselineOperation.responses[status],
        );
        const currentResponse = dereference(
          current,
          currentOperation.responses[status],
        );
        for (const [mediaType, media] of Object.entries(
          baselineResponse.content ?? {},
        )) {
          const candidate = currentResponse.content?.[mediaType];
          if (!candidate)
            fail(
              `${label} removed ${method.toUpperCase()} ${path} response ${status} media type ${mediaType}`,
            );
          compatibleSchema(
            baseline,
            media.schema,
            current,
            candidate.schema,
            `${method.toUpperCase()} ${path} response ${status} ${mediaType}`,
          );
        }
      }
      const baselineParameters = operationParameters(
        baseline,
        baselineOperation,
      );
      const currentParameters = operationParameters(current, currentOperation);
      for (const [key, parameter] of baselineParameters) {
        const candidate = currentParameters.get(key);
        if (!candidate)
          fail(
            `${label} removed ${method.toUpperCase()} ${path} parameter ${key}`,
          );
        if (!parameter.required && candidate.required)
          fail(`${label} made optional parameter ${key} required`);
        compatibleSchema(
          baseline,
          parameter.schema,
          current,
          candidate.schema,
          `${method.toUpperCase()} ${path} parameter ${key}`,
        );
      }
      for (const [key, parameter] of currentParameters) {
        if (parameter.required && !baselineParameters.has(key))
          fail(
            `${label} added required parameter ${key} to ${method.toUpperCase()} ${path}`,
          );
      }
    }
  }
  for (const [name, schema] of Object.entries(
    baseline.components?.schemas ?? {},
  )) {
    compatibleSchema(
      baseline,
      schema,
      current,
      current.components?.schemas?.[name],
      `schema ${name}`,
    );
  }
}

function inspectForbiddenFields(value, location) {
  if (Array.isArray(value))
    return value.forEach((child, index) =>
      inspectForbiddenFields(child, `${location}[${index}]`),
    );
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenFields.has(key))
      fail(`${location}.${key} exposes an internal field`);
    inspectForbiddenFields(child, `${location}.${key}`);
  }
}

async function parseDocument(text, location) {
  try {
    return parse(text, { prettyErrors: true, uniqueKeys: true });
  } catch (error) {
    fail(`${location} is invalid YAML: ${error.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const baselineIndex = args.indexOf("--baseline-ref");
  const baselineRef = baselineIndex === -1 ? null : args[baselineIndex + 1];
  if (baselineIndex !== -1 && !baselineRef)
    fail("--baseline-ref requires a Git ref");
  const text = await readFile(resolve(root, specificationPath), "utf8");
  const document = await parseDocument(text, specificationPath);
  if (document.openapi !== "3.1.0") fail("OpenAPI 3.1.0 is required");
  if (document["x-version-support"]?.additiveOnly !== true)
    fail("v1 must remain additive-only");
  if (!document.security?.length)
    fail("a global authentication requirement is required");
  const operations = new Map();
  for (const [pathName, path] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(path)) {
      if (methods.has(method)) operations.set(operation.operationId, pathName);
    }
  }
  if (
    operations.size !== expectedOperations.size ||
    [...expectedOperations].some(
      ([operation, path]) => operations.get(operation) !== path,
    )
  ) {
    fail(
      `operation set differs from the implemented v1 boundary (${[...operations.keys()].sort().join(", ")})`,
    );
  }
  inspectForbiddenFields(
    document.components?.schemas ?? {},
    "components.schemas",
  );
  for (const example of document["x-contract-examples"] ?? []) {
    const payload = JSON.parse(
      await readFile(resolve(root, example.file), "utf8"),
    );
    inspectForbiddenFields(payload, example.file);
    validateValue(
      document,
      document.components?.schemas?.[example.schema],
      payload,
      example.file,
    );
  }
  if (baselineRef) {
    let baselineText;
    try {
      execFileSync(
        "git",
        ["rev-parse", "--verify", `${baselineRef}^{commit}`],
        { cwd: root, stdio: "ignore" },
      );
    } catch {
      fail(`cannot resolve baseline ref ${baselineRef}`);
    }
    try {
      baselineText = execFileSync(
        "git",
        ["show", `${baselineRef}:${specificationPath}`],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      baselineText = null;
    }
    if (baselineText)
      assertCompatible(
        await parseDocument(
          baselineText,
          `${baselineRef}:${specificationPath}`,
        ),
        document,
        baselineRef,
      );
  }
  const lock = {
    specification: specificationPath,
    openapi: document.openapi,
    version: document.info?.version,
    sha256: digest(document),
  };
  if (write) {
    await writeFile(lockPath, serialized(lock));
  } else {
    const committed = JSON.parse(await readFile(lockPath, "utf8"));
    if (serialized(committed) !== serialized(lock))
      fail(
        "the specification changed; validate compatibility and refresh the lock with npm run api:contract:write",
      );
  }
  console.log(
    `Statistics API ${document.info.version} contract verified (${operations.size} operations, ${(document["x-contract-examples"] ?? []).length} examples).`,
  );
}

await main();
