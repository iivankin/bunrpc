import type {
  AnyProcedure,
  BunRPCHttpMethod,
  BunRPCHttpMethodInput,
  ProcedureRouteDefinition,
} from "../procedure-types";
import type { Router } from "../types";
import { isProcedure } from "./router-metadata";

const HTTP_METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
] as const satisfies readonly BunRPCHttpMethod[];

function trimLeadingSlashes(value: string): string {
  return value.replace(/^\/+/, "");
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeRoutePath(path: string): string {
  const trimmedPath = path.trim();

  if (trimmedPath.length === 0) {
    throw new Error("Procedure route path must be a non-empty string");
  }

  if (trimmedPath === "/") {
    return trimmedPath;
  }

  if (trimmedPath.startsWith("/")) {
    return `/${trimLeadingSlashes(trimTrailingSlashes(trimmedPath))}`;
  }

  return trimLeadingSlashes(trimTrailingSlashes(trimmedPath));
}

function joinBaseAndPath(base: string, path: string): string {
  const normalizedBase = base === "/" ? "" : trimTrailingSlashes(base);
  const normalizedPath = trimLeadingSlashes(path);

  if (normalizedBase.length === 0) {
    return `/${normalizedPath}`;
  }

  if (normalizedPath.length === 0) {
    return normalizedBase;
  }

  return `${normalizedBase}/${normalizedPath}`;
}

export function normalizeHttpMethod(
  method: BunRPCHttpMethodInput = "POST"
): BunRPCHttpMethod {
  const normalizedMethod = method.toUpperCase() as BunRPCHttpMethod;

  if (
    !HTTP_METHODS.includes(normalizedMethod as (typeof HTTP_METHODS)[number])
  ) {
    throw new Error(`Unsupported HTTP method "${method}"`);
  }

  return normalizedMethod;
}

export function createProcedureRouteDefinition(
  path: string,
  method: BunRPCHttpMethodInput = "POST"
): ProcedureRouteDefinition {
  return {
    path: normalizeRoutePath(path),
    method: normalizeHttpMethod(method),
  };
}

export function resolveProcedureHttpPath(prefix: string, path: string): string {
  const normalizedPath = normalizeRoutePath(path);

  if (normalizedPath.startsWith("/")) {
    return normalizedPath;
  }

  return joinBaseAndPath(prefix, normalizedPath);
}

export function buildProcedureUrl(baseUrl: string, path: string): string {
  const normalizedPath = normalizeRoutePath(path);

  if (normalizedPath.startsWith("/")) {
    try {
      return new URL(normalizedPath, baseUrl).toString();
    } catch {
      return normalizedPath;
    }
  }

  return joinBaseAndPath(baseUrl, normalizedPath);
}

export function collectProcedures(
  router: Router,
  currentPath = ""
): Array<{ path: string; procedure: AnyProcedure }> {
  const procedures: Array<{ path: string; procedure: AnyProcedure }> = [];

  for (const [key, value] of Object.entries(router)) {
    const path = currentPath ? `${currentPath}/${key}` : key;

    if (isProcedure(value)) {
      procedures.push({ path, procedure: value });
    } else if (typeof value === "object" && value !== null) {
      procedures.push(...collectProcedures(value as Router, path));
    }
  }

  return procedures;
}

export function resolveProcedureHttpRoute(
  prefix: string,
  path: string,
  procedure: Pick<AnyProcedure, "_route">
): {
  fullPath: string;
  httpMethod: BunRPCHttpMethod;
  path: string;
  routePath: string;
} {
  const routePath = procedure._route?.path ?? path;
  const httpMethod = procedure._route?.method ?? "POST";

  return {
    path,
    routePath,
    fullPath: resolveProcedureHttpPath(prefix, routePath),
    httpMethod,
  };
}
