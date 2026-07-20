import { describe, expect, test } from "bun:test";
import { stagePackage } from "./stage-package";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  version: string;
}

async function readPackageJson(path: string) {
  return (await Bun.file(path).json()) as PackageJson;
}

describe("package staging", () => {
  test("replaces workspace links with registry versions", async () => {
    const root = new URL("../", import.meta.url);
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
