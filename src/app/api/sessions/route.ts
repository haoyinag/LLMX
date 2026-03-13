import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

type StoredMessage = {
  id: string | number;
  status: string;
  message: unknown;
  extraInfo?: Record<string, unknown>;
};

type StoreShape = {
  sessions: Record<string, { title: string; createdAt: number; updatedAt?: number; order?: number }>;
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
    .map(([id, meta]) => ({
      id,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      order: meta.order,
      hasMessages: (store.messages[id]?.length ?? 0) > 0
    }))
    .sort((a, b) => {
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt);
    });

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
  const sessionId = body?.sessionId?.trim() || randomUUID();
  const title = body?.title?.trim() || "新对话";
  const now = Date.now();

  await (writeLock = writeLock.then(async () => {
    const store = await readStore();
    const existing = store.sessions[sessionId];
    store.sessions[sessionId] = {
      title: title.slice(0, 32),
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing?.updatedAt,
      order: existing?.order
    };
    if (!store.messages[sessionId]) store.messages[sessionId] = [];
    await writeStore(store);
  }));

  return new Response(JSON.stringify({ sessionId }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function DELETE(request: Request) {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "Missing sessionId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  await (writeLock = writeLock.then(async () => {
    const store = await readStore();
    delete store.sessions[sessionId];
    delete store.messages[sessionId];
    await writeStore(store);
  }));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function PATCH(request: Request) {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const body = (await request.json()) as { order?: string[]; sessionId?: string; title?: string };
  const order = Array.isArray(body?.order) ? body.order : [];
  const sessionId = body?.sessionId?.trim();
  const title = body?.title?.trim();

  if (order.length === 0 && !sessionId) {
    return new Response(JSON.stringify({ error: "Invalid payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  await (writeLock = writeLock.then(async () => {
    const store = await readStore();
    if (order.length > 0) {
      order.forEach((id, index) => {
        const existing = store.sessions[id];
        if (existing) {
          store.sessions[id] = {
            ...existing,
            order: index + 1
          };
        }
      });
    }
    if (sessionId && title) {
      const existing = store.sessions[sessionId];
      if (existing) {
        store.sessions[sessionId] = {
          ...existing,
          title: title.slice(0, 32)
        };
      }
    }
    await writeStore(store);
  }));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
