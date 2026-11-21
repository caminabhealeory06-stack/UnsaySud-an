import type { IncomingMessage, ServerResponse } from "http";
import { createApiApp } from "../src/server/createApp";
import { ensureCoreDirectories } from "../src/server/storage";

const app = createApiApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  ensureCoreDirectories();
  // Normalize /api/index... if invoked directly via Vercel's /api/index path
  if (req.url && req.url.startsWith("/api/index")) {
    const rest = req.url.slice("/api/index".length);
    req.url = rest ? `/api${rest.startsWith("/") ? rest : `/${rest}`}` : "/api/health";
  }
  return app(req as any, res as any);
}
