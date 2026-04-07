import { describe, expect, test } from "bun:test";

interface PackageJson {
  dependencies?: Record<string, string>;
  version: string;
}

async function readPackageJson(path: string): Promise<PackageJson> {
  return (await Bun.file(path).json()) as PackageJson;
}

describe("publish metadata", () => {
  test("published bunrpc plugins pin the current core version", async () => {
    const root = new URL("../../../", import.meta.url);
    const corePackage = await readPackageJson(
      new URL("packages/core/package.json", root).pathname
    );
    const coreVersion = corePackage.version;

    for (const packageName of ["mcp", "openapi", "react"] as const) {
      const packageJson = await readPackageJson(
        new URL(`packages/${packageName}/package.json`, root).pathname
      );

      expect(packageJson.dependencies?.["@bunrpc/core"]).toBe(coreVersion);
    }
  });
});
