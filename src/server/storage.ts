import fs from "fs";
import path from "path";

function resolveAppRoot(): string {
  const cwd = process.cwd();
  if (
    fs.existsSync(path.join(cwd, "package.json")) ||
    fs.existsSync(path.join(cwd, "data"))
  ) {
    return cwd;
  }
  if (typeof __dirname === "string") {
    const parentDir = path.resolve(__dirname, "..");
    if (
      fs.existsSync(path.join(parentDir, "package.json")) ||
      fs.existsSync(path.join(parentDir, "data"))
    ) {
      return parentDir;
    }
  }
  return cwd;
}

export const APP_ROOT = resolveAppRoot();
export const DATA_DIR = path.resolve(APP_ROOT, "data");
export const PUBLIC_DIR = path.resolve(APP_ROOT, "public");
export const PRIVATE_PROOFS_DIR = path.join(DATA_DIR, "proofs");
export const PUBLIC_DISH_UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads", "dishes");
export const PUBLIC_ADMIN_UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads", "admin");

export function ensureCoreDirectories() {
  [DATA_DIR, PRIVATE_PROOFS_DIR, PUBLIC_DISH_UPLOADS_DIR, PUBLIC_ADMIN_UPLOADS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
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
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
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
