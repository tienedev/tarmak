// agent/src/index.ts
import { startServer } from "./server.js";

const serverUrl = process.argv.find((_, i, a) => a[i - 1] === "--server") ?? "http://localhost:4000";
const token = process.argv.find((_, i, a) => a[i - 1] === "--token") ?? "";
const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") ?? "9876", 10);
const origins = (process.argv.find((_, i, a) => a[i - 1] === "--allowed-origins") ?? "http://localhost:3000,http://localhost:4000").split(",");

startServer({ serverUrl, serverToken: token, port, allowedOrigins: origins });
