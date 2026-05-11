import { mkdir, readdir, copyFile, link, access, writeFile, rm, symlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { SolarOutputLayout } from "./jobs.js";

export function createSolarOutputLayout(outputRootDir: string, inputPath: string): SolarOutputLayout {
  const stem = basename(inputPath, extname(inputPath));
  const jobRootDir = resolve(outputRootDir, stem);
  return {
    jobRootDir,
    sourceDir: join(jobRootDir, "source"),
    stackedDir: join(jobRootDir, "stacked"),
    finalDir: join(jobRootDir, "final"),
    reviewDir: join(jobRootDir, "review"),
    metadataPath: join(jobRootDir, "metadata.json"),
  };
}

export async function ensureSolarLayout(layout: SolarOutputLayout): Promise<void> {
  await mkdir(layout.sourceDir, { recursive: true });
  await mkdir(layout.stackedDir, { recursive: true });
  await mkdir(layout.finalDir, { recursive: true });
  await mkdir(layout.reviewDir, { recursive: true });
}

export async function stageSourceAsset(inputPath: string, layout: SolarOutputLayout): Promise<{ sourceVideoPath: string; sourceCompanionPaths: string[] }> {
  const inputName = basename(inputPath);
  const sourceVideoPath = join(layout.sourceDir, inputName);
  await copyOrLink(inputPath, sourceVideoPath);

  const companions = await discoverCompanionFiles(inputPath);
  const sourceCompanionPaths: string[] = [];
  for (const companion of companions) {
    const staged = join(layout.sourceDir, basename(companion));
    await copyOrLink(companion, staged);
    sourceCompanionPaths.push(staged);
  }

  return { sourceVideoPath, sourceCompanionPaths };
}

export async function writeSolarMetadata(metadataPath: string, payload: unknown): Promise<void> {
  await writeFile(metadataPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

export async function createOrReplaceSymlink(targetPath: string, linkPath: string): Promise<void> {
  try {
    await rm(linkPath, { force: true });
  } catch {
    // ignore
  }
  await symlink(targetPath, linkPath);
}

async function discoverCompanionFiles(inputPath: string): Promise<string[]> {
  const dirPath = dirname(inputPath);
  const baseName = basename(inputPath);
  const entries = await readdir(dirPath);
  return entries
    .filter((entry) => entry !== baseName && entry.startsWith(baseName))
    .map((entry) => join(dirPath, entry));
}

async function copyOrLink(sourcePath: string, destPath: string): Promise<void> {
  try {
    await access(destPath);
    return;
  } catch {
    // continue
  }

  try {
    await link(sourcePath, destPath);
  } catch {
    await copyFile(sourcePath, destPath);
  }
}
