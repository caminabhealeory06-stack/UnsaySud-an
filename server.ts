import "dotenv/config";
import express from "express";
import path from "path";
import { createApiApp } from "./src/server/createApp";
import { APP_ROOT } from "./src/server/storage";

async function startServer() {
  const app = createApiApp();
  const PORT = Number(process.env.PORT) || 3000;

  const isBundledServer =
    (typeof __filename === "string" && path.basename(__filename) === "server.cjs") ||
    (process.argv[1] || "").endsWith("server.cjs");
  const isProduction = process.env.NODE_ENV === "production" || isBundledServer;

  if (!isProduction) {
    if (process.env.DISABLE_HMR === "true") {
      // Vite 8 injects /@vite/client in middlewareMode even when server.hmr is false,
      // which attempts a WebSocket connection to port 24678 and throws
      // "[vite] Error: WebSocket closed without opened." behind the proxy.
      // Serve a lightweight ESM client shim that preserves CSS injection and
      // import.meta.hot APIs without opening any WebSocket.
      app.get("/@vite/client", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.send(`
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if ("document" in globalThis) {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => {
        lastInsertedStyle = void 0;
      }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll(\`link[rel="stylesheet"][data-vite-dev-id="\${CSS.escape(id)}"]\`).forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    decline: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return \`\${pathname}?\${queryToInject}\${search ? "&" + search.slice(1) : ""}\${hash || ""}\`;
}
const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};
export class ErrorOverlay extends BaseElement {
  close() {
    this.parentNode?.removeChild(this);
  }
}
`);
      });
    }

    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(APP_ROOT, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Unsay Sud-an? server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
