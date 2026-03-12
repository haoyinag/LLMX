export const runtime = "edge";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
const CONCURRENCY_MAX = Number(process.env.CONCURRENCY_MAX || 2);
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 20_000);
const MAX_COMPLETION_TOKENS = Number(process.env.MAX_COMPLETION_TOKENS || 1024);

const rateState = new Map<string, { count: number; resetAt: number }>();
const concurrencyState = new Map<string, number>();

function getApiKey(headers: Headers) {
  const bearer = headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }
  return headers.get("x-api-key") || "";
}

function getClientId(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return headers.get("cf-connecting-ip") || headers.get("x-real-ip") || "anonymous";
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

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing DEEPSEEK_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
  const fallbackModel = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;

  const clientId = getClientId(request.headers);
  const now = Date.now();
  const rateEntry = rateState.get(clientId);
  if (!rateEntry || now >= rateEntry.resetAt) {
    rateState.set(clientId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else if (rateEntry.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((rateEntry.resetAt - now) / 1000);
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter)
      }
    });
  } else {
    rateEntry.count += 1;
  }

  const currentConcurrent = concurrencyState.get(clientId) || 0;
  if (currentConcurrent >= CONCURRENCY_MAX) {
    return new Response(JSON.stringify({ error: "Too many concurrent requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json" }
    });
  }
  concurrencyState.set(clientId, currentConcurrent + 1);

  const body = await request.json();
  const { modelId, model, messages, ...rest } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    concurrencyState.set(clientId, Math.max(0, currentConcurrent));
    return new Response(JSON.stringify({ error: "Missing messages" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const inputChars = messages.reduce((sum: number, msg: any) => {
    const content = typeof msg?.content === "string" ? msg.content : msg?.content?.text || "";
    return sum + String(content).length;
  }, 0);
  if (inputChars > MAX_INPUT_CHARS) {
    concurrencyState.set(clientId, Math.max(0, currentConcurrent));
    return new Response(JSON.stringify({ error: "Input too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" }
    });
  }

  const requestedMax =
    Number(rest?.max_completion_tokens ?? rest?.max_tokens ?? 0) || MAX_COMPLETION_TOKENS;

  const payload = {
    ...rest,
    model: modelId || model || fallbackModel,
    messages,
    stream: true,
    max_completion_tokens: Math.min(requestedMax, MAX_COMPLETION_TOKENS)
  };

  try {
    const upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: request.signal
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return new Response(errorText, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("content-type") || "application/json"
        }
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    });
  } finally {
    const prev = concurrencyState.get(clientId) || 1;
    concurrencyState.set(clientId, Math.max(0, prev - 1));
  }
}
