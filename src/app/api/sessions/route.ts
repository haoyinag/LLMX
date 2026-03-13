import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

type StoredMessage = {
  id: string | number;
  status: string;
  message: unknown;
  extraInfo?: Record<string, unknown>;
};

type StoreShape = {
  sessions: Record<string, { title: string; updatedAt: number }>;
  messages: Record<string, StoredMessage[]>;
};

const DATA_DIR = process.env.SESSION_DB_PATH || ".data";
const STORE_FILE = path.join(process.cwd(), DATA_DIR, "sessions.json");

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
    const parsed = JSON.parse(data) as StoreShape | Record<string, StoredMessage[]>;
    if ("messages" in parsed && "sessions" in parsed) {
      return parsed as StoreShape;
    }
    return { sessions: {}, messages: parsed as Record<string, StoredMessage[]> };
  } catch {
    return { sessions: {}, messages: {} };
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

  const store = await readStore();
  const sessions = Object.entries(store.sessions)
    .map(([id, meta]) => ({ id, title: meta.title, updatedAt: meta.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return new Response(JSON.stringify({ sessions }), {
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

  const body = (await request.json()) as { sessionId?: string; title?: string };
  const sessionId = body?.sessionId?.trim() || `session_${Date.now()}`;
  const title = body?.title?.trim() || "新对话";

  await (writeLock = writeLock.then(async () => {
    const store = await readStore();
    store.sessions[sessionId] = { title: title.slice(0, 32), updatedAt: Date.now() };
    if (!store.messages[sessionId]) store.messages[sessionId] = [];
    await writeStore(store);
  }));

  return new Response(JSON.stringify({ sessionId }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
