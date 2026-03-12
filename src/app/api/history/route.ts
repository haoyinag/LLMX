import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

type StoredMessage = {
  id: string | number;
  status: string;
  message: unknown;
  extraInfo?: Record<string, unknown>;
};

type StoreShape = Record<string, StoredMessage[]>;

const DATA_DIR = process.env.SESSION_DB_PATH || ".data";
const STORE_FILE = path.join(process.cwd(), DATA_DIR, "sessions.json");
const MAX_STORED_MESSAGES = Number(process.env.MAX_STORED_MESSAGES || 200);

let writeLock: Promise<void> = Promise.resolve();

function getApiKey(headers: Headers) {
  const bearer = headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }
  return headers.get("x-api-key") || "";
}

function isAuthorized(request: Request) {
  const appKey = process.env.APP_API_KEY || "";
  const bypass = process.env.AUTH_BYPASS === "true";
  if (bypass) return true;

  if (!appKey) {
    return process.env.NODE_ENV !== "production";
  }

  return getApiKey(request.headers) === appKey;
}

async function ensureStore() {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
}

async function readStore(): Promise<StoreShape> {
  try {
    const data = await fs.readFile(STORE_FILE, "utf-8");
    return JSON.parse(data) as StoreShape;
  } catch {
    return {};
  }
}

async function writeStore(store: StoreShape) {
  await ensureStore();
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "Missing sessionId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const store = await readStore();
  const messages = store[sessionId] || [];

  return new Response(JSON.stringify({ messages }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const body = (await request.json()) as {
    sessionId?: string;
    messages?: StoredMessage[];
  };

  const sessionId = body?.sessionId?.trim();
  if (!sessionId || !Array.isArray(body?.messages)) {
    return new Response(JSON.stringify({ error: "Invalid payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const trimmed = body.messages.slice(-MAX_STORED_MESSAGES);

  await (writeLock = writeLock.then(async () => {
    const store = await readStore();
    store[sessionId] = trimmed;
    await writeStore(store);
  }));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
