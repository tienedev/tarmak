import { serveStatic } from "@hono/node-server/serve-static";

export function staticFiles(root: string) {
  return serveStatic({ root });
}
