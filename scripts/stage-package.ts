import fs from "node:fs/promises";
import path from "node:path";

const packageNames = ["core", "mcp", "openapi", "react"] as const;

export type PackageName = (typeof packageNames)[number];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name: string;
  scripts?: Record<string, string>;
  version: string;
  [key: string]: unknown;
}

const rootDir = path.resolve(import.meta.dir, "..");
const packagesDir = path.join(rootDir, "packages");
const releaseDir = path.join(rootDir, ".tmp-release");

function getArg(name: string) {
  const prefix = `${name}=`;
  return Bun.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function isPackageName(value: string): value is PackageName {
  return packageNames.includes(value as PackageName);
}

async function readPackageJson(packageName: PackageName) {
  return (await Bun.file(
    path.join(packagesDir, packageName, "package.json")
  ).json()) as PackageJson;
}

function resolveWorkspaceSpecifier(specifier: string, version: string) {
  if (specifier === "workspace:*") {
    return version;
  }
  if (specifier === "workspace:^") {
    return `^${version}`;
  }
  if (specifier === "workspace:~") {
    return `~${version}`;
  }

  throw new Error(`Unsupported workspace dependency specifier: ${specifier}`);
}

function resolveDependencies(
  dependencies: Record<string, string> | undefined,
  workspaceVersions: ReadonlyMap<string, string>
) {
  if (!dependencies) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(dependencies).map(([name, specifier]) => {
      if (!specifier.startsWith("workspace:")) {
        return [name, specifier];
      }

      const version = workspaceVersions.get(name);
      if (!version) {
        throw new Error(`Unknown workspace dependency: ${name}`);
      }

      return [name, resolveWorkspaceSpecifier(specifier, version)];
    })
  );
}

async function copyIfPresent(
  sourceDir: string,
  destinationDir: string,
  name: string
) {
  const source = path.join(sourceDir, name);
  if (await Bun.file(source).exists()) {
    await fs.copyFile(source, path.join(destinationDir, name));
  }
}

export async function stagePackage(packageName: PackageName) {
  const workspacePackages = await Promise.all(
    packageNames.map(
      async (name) => [name, await readPackageJson(name)] as const
    )
  );
  const workspaceVersions = new Map(
    workspacePackages.map(([, packageJson]) => [
      packageJson.name,
      packageJson.version,
    ])
  );
  const sourcePackage = workspacePackages.find(
    ([name]) => name === packageName
  )?.[1];

  if (!sourcePackage) {
    throw new Error(`Unknown package: ${packageName}`);
  }

  const {
    devDependencies: _devDependencies,
    scripts: _scripts,
    ...publishPackage
  } = sourcePackage;
  publishPackage.dependencies = resolveDependencies(
    sourcePackage.dependencies,
    workspaceVersions
  );

  const sourceDir = path.join(packagesDir, packageName);
  const destinationDir = path.join(releaseDir, packageName);

  await fs.rm(destinationDir, { force: true, recursive: true });
  await fs.mkdir(destinationDir, { recursive: true });
  await fs.cp(path.join(sourceDir, "src"), path.join(destinationDir, "src"), {
    filter: (source) => !/\.test\.[cm]?[jt]sx?$/.test(source),
    recursive: true,
  });

  for (const name of ["README.md", "LICENSE", "CHANGELOG.md"]) {
    await copyIfPresent(sourceDir, destinationDir, name);
  }

  await Bun.write(
    path.join(destinationDir, "package.json"),
    `${JSON.stringify(publishPackage, null, 2)}\n`
  );

  return destinationDir;
}

if (import.meta.main) {
  const packageName = getArg("--package");
  if (!(packageName && isPackageName(packageName))) {
    throw new Error(
      `Expected --package to be one of: ${packageNames.join(", ")}`
    );
  }

  const destination = await stagePackage(packageName);
  console.log(`Staged ${packageName} in ${destination}`);
}
