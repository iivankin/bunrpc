import { describe, expect, test } from "bun:test";
import { stagePackage } from "../../../scripts/stage-package";

interface BunLock {
  workspaces: Record<
    string,
    {
      dependencies?: Record<string, string>;
      version?: string;
    }
  >;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  version: string;
}

async function readPackageJson(path: string): Promise<PackageJson> {
  return (await Bun.file(path).json()) as PackageJson;
}

async function readBunLock(path: string): Promise<BunLock> {
  const source = await Bun.file(path).text();

  // Bun's text lockfile format is JSON-like, but it permits trailing commas.
  return Function(`"use strict"; return (${source});`)() as BunLock;
}

describe("publish metadata", () => {
  test("bun.lock workspace versions stay in sync with published package versions", async () => {
    const root = new URL("../../../", import.meta.url);
    const bunLock = await readBunLock(new URL("bun.lock", root).pathname);

    for (const packageName of ["core", "mcp", "openapi", "react"] as const) {
      const packageJson = await readPackageJson(
        new URL(`packages/${packageName}/package.json`, root).pathname
      );
      const workspace = bunLock.workspaces[`packages/${packageName}`];

      expect(workspace?.version).toBe(packageJson.version);
    }
  });

  test("plugins keep workspace links to core in source manifests", async () => {
    const root = new URL("../../../", import.meta.url);

    for (const packageName of ["mcp", "openapi", "react"] as const) {
      const packageJson = await readPackageJson(
        new URL(`packages/${packageName}/package.json`, root).pathname
      );

      expect(packageJson.dependencies?.["@bunrpc/core"]).toBe("workspace:*");
    }
  });

  test("staged packages replace workspace links with registry versions", async () => {
    const root = new URL("../../../", import.meta.url);
    const corePackage = await readPackageJson(
      new URL("packages/core/package.json", root).pathname
    );
    const destination = await stagePackage("react");
    const releasePackage = await readPackageJson(`${destination}/package.json`);

    expect(releasePackage.dependencies?.["@bunrpc/core"]).toBe(
      corePackage.version
    );
    expect(releasePackage.devDependencies).toBeUndefined();
    expect(releasePackage.scripts).toBeUndefined();
    expect(await Bun.file(`${destination}/src/index.ts`).exists()).toBe(true);
    expect(await Bun.file(`${destination}/src/index.test.ts`).exists()).toBe(
      false
    );
  });
});
