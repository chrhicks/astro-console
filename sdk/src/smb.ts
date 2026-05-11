import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ShareEntry } from "./types.js";

const execFileAsync = promisify(execFile);

const LS_LINE_RE = /^\s{2}(.*?)\s+([A-Z]+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})$/;

/**
 * List entries from the Seestar SMB share. This exposes the real files inside
 * `MyWorks/...`, unlike `get_albums`, which is only an album summary API.
 */
export async function listShareDirectory(
  host: string,
  directory: string,
  shareName = "EMMC Images"
): Promise<ShareEntry[]> {
  const target = `//${host}/${shareName}`;
  const smbDir = normalizeSmbPath(directory);
  const { stdout } = await execFileAsync("smbclient", [
    "-N",
    target,
    "-c",
    `cd ${smbDir}; ls`,
  ]);

  return stdout
    .split(/\r?\n/)
    .map(parseLsLine)
    .filter((entry): entry is ShareEntry => entry !== null)
    .filter((entry) => entry.name !== "." && entry.name !== "..");
}

function normalizeSmbPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .join("/");
}

function parseLsLine(line: string): ShareEntry | null {
  const match = line.match(LS_LINE_RE);
  if (!match) {
    return null;
  }

  const [, rawName, flags, rawSize, modifiedRaw] = match;
  const name = rawName.trimEnd();
  const isDirectory = flags.includes("D");

  return {
    name,
    path: name,
    isDirectory,
    sizeBytes: Number(rawSize),
    flags,
    modifiedRaw,
  };
}
