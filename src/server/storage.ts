import fs from "fs";
import os from "os";
import path from "path";
import { loadPersistedFile, persistDocument, persistFile, removePersistedFile } from "./persistence";

export const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
/** Set by the Netlify Server entrypoint (netlify/server/index.ts) before the API modules load. */
export const IS_NETLIFY_SERVER = process.env.UNSAY_RUNTIME === "netlify-server";
/** Hosts whose local filesystem is read-only/ephemeral: working files live in the OS temp dir. */
export const IS_EPHEMERAL_FS = IS_VERCEL || IS_NETLIFY_SERVER;

function resolveAppRoot(): string {
  const candidates: string[] = [process.cwd()];
  if (typeof __dirname === "string") {
    candidates.push(
      __dirname,
      path.resolve(__dirname, ".."),
      path.resolve(__dirname, "..", ".."),
      path.resolve(__dirname, "..", "..", "..")
    );
  }
  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, "data", "menu_items.json")) ||
      fs.existsSync(path.join(dir, "package.json"))
    ) {
      return dir;
    }
  }
  return process.cwd();
}

export const APP_ROOT = resolveAppRoot();
export const SEED_DATA_DIR = path.resolve(APP_ROOT, "data");
export const PUBLIC_DIR = path.resolve(APP_ROOT, "public");
export const SEED_UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");

export const DATA_DIR = IS_EPHEMERAL_FS
  ? path.resolve(process.env.DATA_DIR || path.join(os.tmpdir(), "oursudan-data"))
  : SEED_DATA_DIR;

export const PRIVATE_PROOFS_DIR = path.join(DATA_DIR, "proofs");

export const RUNTIME_UPLOADS_DIR = IS_EPHEMERAL_FS
  ? path.join(os.tmpdir(), "oursudan-uploads")
  : SEED_UPLOADS_DIR;

export const PUBLIC_DISH_UPLOADS_DIR = path.join(RUNTIME_UPLOADS_DIR, "dishes");
export const PUBLIC_ADMIN_UPLOADS_DIR = path.join(RUNTIME_UPLOADS_DIR, "admin");

function seedDirectoryIfMissing(sourceDir: string, targetDir: string) {
  if (!fs.existsSync(sourceDir) || path.resolve(sourceDir) === path.resolve(targetDir)) {
    return;
  }
  try {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === ".gitkeep") continue;
      const srcPath = path.join(sourceDir, entry.name);
      const dstPath = path.join(targetDir, entry.name);
      if (!fs.existsSync(dstPath)) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  } catch (err) {
    console.warn(`Seed copy warning from ${sourceDir} to ${targetDir}:`, err);
  }
}

export function ensureCoreDirectories() {
  [DATA_DIR, PRIVATE_PROOFS_DIR, PUBLIC_DISH_UPLOADS_DIR, PUBLIC_ADMIN_UPLOADS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  if (IS_EPHEMERAL_FS) {
    seedDirectoryIfMissing(SEED_DATA_DIR, DATA_DIR);
    seedDirectoryIfMissing(path.join(SEED_UPLOADS_DIR, "dishes"), PUBLIC_DISH_UPLOADS_DIR);
    seedDirectoryIfMissing(path.join(SEED_UPLOADS_DIR, "admin"), PUBLIC_ADMIN_UPLOADS_DIR);
  }
}

export function resolveSafePath(rootDir: string, ...segments: string[]): string {
  const rootResolved = path.resolve(rootDir);
  const candidate = path.resolve(rootResolved, ...segments);
  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + path.sep)) {
    throw new Error("Invalid file path outside permitted directory.");
  }
  return candidate;
}

export function checkJsonStorePermissions(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
  if (fs.existsSync(filePath)) {
    fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK);
  }
}

export function readJsonArrayStrict<T>(filePath: string): T[] {
  checkJsonStorePermissions(filePath);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(
      `Database file ${path.basename(filePath)} contains invalid JSON: ${err?.message || "parse error"}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Database file ${path.basename(filePath)} has invalid format: expected a JSON array.`
    );
  }
  return parsed as T[];
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`Failed reading JSON file ${filePath}:`, err);
    return fallback;
  }
}

export function writeJsonFile<T>(filePath: string, data: T): boolean {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmpPath, json, "utf-8");
    fs.renameSync(tmpPath, filePath);
    if (path.resolve(path.dirname(filePath)) === path.resolve(DATA_DIR)) {
      persistDocument(path.basename(filePath), json);
    }
    return true;
  } catch (err) {
    console.error(`Failed writing JSON file ${filePath}:`, err);
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore cleanup error
    }
    return false;
  }
}

/**
 * Durable storage key for a runtime file (uploaded dish photos, admin QR codes, private
 * payment proofs), or null when the path is outside the managed directories.
 */
function durableFileKey(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  const roots: Array<[string, string]> = [
    [path.resolve(RUNTIME_UPLOADS_DIR), "uploads"],
    [path.resolve(PRIVATE_PROOFS_DIR), "proofs"]
  ];
  for (const [root, prefix] of roots) {
    if (resolved.startsWith(root + path.sep)) {
      return `${prefix}/${path.relative(root, resolved).split(path.sep).join("/")}`;
    }
  }
  return null;
}

/** Writes an uploaded binary file locally and mirrors it to durable storage when configured. */
export function writeBinaryFile(filePath: string, data: Buffer) {
  fs.writeFileSync(filePath, data);
  const key = durableFileKey(filePath);
  if (key) persistFile(key, data);
}

/** Deletes an uploaded binary file locally and from durable storage when configured. */
export function deleteBinaryFile(filePath: string) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  const key = durableFileKey(filePath);
  if (key) removePersistedFile(key);
}

/**
 * Ensures a runtime file exists on the local disk, restoring it from durable storage if a
 * cold start wiped it. Returns true when the file is available locally.
 */
export async function ensureLocalFile(filePath: string): Promise<boolean> {
  if (fs.existsSync(filePath)) return true;
  const key = durableFileKey(filePath);
  if (!key) return false;
  try {
    const data = await loadPersistedFile(key);
    if (!data) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
    return true;
  } catch (err) {
    console.error(`Failed restoring ${key} from durable storage:`, err);
    return false;
  }
}
