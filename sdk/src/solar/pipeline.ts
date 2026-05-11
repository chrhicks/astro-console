import { execFile } from "node:child_process";
import { basename, join, extname, resolve } from "node:path";
import { promisify } from "node:util";
import { createSolarOutputLayout, ensureSolarLayout, stageSourceAsset, writeSolarMetadata } from "./files.js";
import { runPssStack } from "./pss.js";
import type { SolarProcessJob, SolarProcessResult } from "./jobs.js";

const execFileAsync = promisify(execFile);

export async function runSolarPipeline(job: SolarProcessJob): Promise<SolarProcessResult> {
  const layout = createSolarOutputLayout(job.outputRootDir, job.inputPath);
  await ensureSolarLayout(layout);

  const { sourceVideoPath, sourceCompanionPaths } = await stageSourceAsset(job.inputPath, layout);
  const stackedTiffPath = await runPssStack(sourceVideoPath, layout.stackedDir, job.pss);

  await runPythonModule(job, "seestar_solar.finish", [
    stackedTiffPath,
    "--output-dir",
    layout.finalDir,
    "--review-dir",
    layout.reviewDir,
  ]);

  const stackedStem = basename(stackedTiffPath, extname(stackedTiffPath));
  const grayscaleNaturalPath = join(layout.finalDir, `${stackedStem}_natural.png`);
  const grayscaleFinalPath = join(layout.finalDir, `${stackedStem}_final.png`);

  await runPythonModule(job, "seestar_solar.present", [
    grayscaleFinalPath,
    "--output-dir",
    layout.finalDir,
    "--review-dir",
    layout.reviewDir,
    "--styles",
    "mono_natural,artistic_gold",
  ]);

  const presentationMonoPath = join(layout.finalDir, `${stackedStem}_final_mono_natural.png`);
  const presentationArtisticGoldPath = join(layout.finalDir, `${stackedStem}_final_artistic_gold.png`);

  const metadata = {
    createdAt: new Date().toISOString(),
    inputPath: resolve(job.inputPath),
    sourceVideoPath,
    sourceCompanionPaths,
    stacker: "pss",
    stackPercent: job.pss.stackPercent,
    referenceFramePercent: job.pss.referenceFramePercent,
    outputs: {
      stackedTiffPath,
      grayscaleNaturalPath,
      grayscaleFinalPath,
      presentationMonoPath,
      presentationArtisticGoldPath,
      reviewDir: layout.reviewDir,
    },
  };
  await writeSolarMetadata(layout.metadataPath, metadata);

  return {
    layout,
    sourceVideoPath,
    sourceCompanionPaths,
    stackedTiffPath,
    grayscaleNaturalPath,
    grayscaleFinalPath,
    presentationMonoPath,
    presentationArtisticGoldPath,
    metadataPath: layout.metadataPath,
  };
}

async function runPythonModule(job: SolarProcessJob, moduleName: string, args: string[]): Promise<void> {
  await execFileAsync(job.pss.pythonBin, ["-m", moduleName, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONPATH: job.python.modulePath,
    },
  });
}
