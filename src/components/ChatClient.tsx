"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bubble, Sender, Welcome } from "@ant-design/x";
import { Select, Tag } from "antd";
import {
  DeepSeekChatProvider,
  type XModelMessage,
  type XModelParams,
  useXChat,
  XRequest
} from "@ant-design/x-sdk";
import { renderMarkdownToHtml } from "@/lib/markdown";
import { useModelStore } from "@/store/model";

const MODEL_OPTIONS = (process.env.NEXT_PUBLIC_MODEL_OPTIONS ?? "deepseek-chat,deepseek-reasoner")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

type BubbleMessage = {
  role: "user" | "ai" | "system";
  content: string;
};

type StoredMessage = {
  id: string | number;
  status: string;
  message: XModelMessage;
  extraInfo?: Record<string, unknown>;
};

const SESSION_ID_KEY = "llmx:session_id";
const LOCAL_STORAGE_KEY = "llmx:messages";

function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  const existing = window.localStorage.getItem(SESSION_ID_KEY);
  if (existing) return existing;
  const next = window.crypto?.randomUUID?.() ?? `session_${Date.now()}`;
  window.localStorage.setItem(SESSION_ID_KEY, next);
  return next;
}

export default function ChatClient() {
  const { modelId, setModelId } = useModelStore();
  const [input, setInput] = useState("");
  const [sessionId] = useState(() => getSessionId());
  const storageMode = process.env.NEXT_PUBLIC_SESSION_STORAGE || "local";

  const appApiKey = process.env.NEXT_PUBLIC_APP_API_KEY || "";

  const request = useMemo(
    () =>
      XRequest<XModelParams>("/api/chat", {
        manual: true,
        headers: {
          "Content-Type": "application/json",
          ...(appApiKey ? { "x-api-key": appApiKey } : {})
        }
      }),
    [appApiKey]
  );

  const provider = useMemo(() => new DeepSeekChatProvider({ request }), [request]);

  const { messages, parsedMessages, onRequest, isRequesting, abort } = useXChat<
    XModelMessage,
    BubbleMessage,
    XModelParams
  >({
    provider,
    defaultMessages: async () => {
      if (storageMode === "db") {
        const resp = await fetch(`/api/history?sessionId=${encodeURIComponent(sessionId)}`, {
          headers: appApiKey ? { "x-api-key": appApiKey } : undefined
        });
        if (!resp.ok) return [];
        const data = (await resp.json()) as { messages?: StoredMessage[] };
        return (data.messages ?? []).map((item) => ({
          status: item.status,
          message: item.message,
          extraInfo: item.extraInfo
        }));
      }

      if (typeof window === "undefined") return [];
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as StoredMessage[];
        return parsed.map((item) => ({
          status: item.status,
          message: item.message,
          extraInfo: item.extraInfo
        }));
      } catch {
        return [];
      }
    },
    parser: (message) => {
      const content =
        typeof message.content === "string" ? message.content : message.content?.text || "";
      return {
        role: message.role === "assistant" ? "ai" : (message.role as BubbleMessage["role"]),
        content
      };
    }
  });

  const items = parsedMessages.map((msg) => ({
    key: msg.id,
    role: msg.message.role,
    content: msg.message.content,
    status: msg.status,
    streaming: msg.status === "updating",
    loading: msg.status === "loading"
  }));

  const roleConfig = {
    ai: {
      placement: "start" as const,
      classNames: {
        content: "bg-white shadow-sm"
      },
      contentRender: (content: string) => (
        <div
          className="markdown"
          dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(content) }}
        />
      )
    },
    user: {
      placement: "end" as const,
      classNames: {
        content: "bg-slate-900 text-white"
      }
    },
    system: {
      placement: "start" as const
    }
  };

  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const payload: StoredMessage[] = messages.map((item) => ({
      id: item.id,
      status: item.status,
      message: item.message,
      extraInfo: item.extraInfo
    }));

    if (storageMode === "db") {
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = setTimeout(() => {
        fetch("/api/history", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(appApiKey ? { "x-api-key": appApiKey } : {})
          },
          body: JSON.stringify({ sessionId, messages: payload })
        }).catch(() => {});
      }, 500);
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
    }
  }, [messages, storageMode, sessionId, appApiKey]);

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    onRequest({
      model: modelId,
      stream: true,
      messages: [{ role: "user", content: trimmed }]
    });
    setInput("");
  };

  return (
    <div className="flex h-screen w-full flex-col">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <div className="text-lg font-semibold">LLMX Chat</div>
            <div className="text-xs text-slate-500">DeepSeek streaming via Next.js Edge</div>
          </div>
          <div className="flex items-center gap-3">
            <Tag color={isRequesting ? "processing" : "default"}>
              {isRequesting ? "生成中" : "就绪"}
            </Tag>
            <Select
              size="middle"
              value={modelId}
              onChange={setModelId}
              options={MODEL_OPTIONS.map((value) => ({ label: value, value }))}
              className="min-w-[180px]"
            />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-6">
          {items.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <Welcome
                title="欢迎使用 LLMX"
                description="开箱即用的 DeepSeek SSE 模板"
              />
            </div>
          ) : (
            <Bubble.List
              className="h-full overflow-y-auto rounded-2xl bg-white/80 p-4 shadow-sm"
              role={roleConfig}
              items={items}
              autoScroll
            />
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto w-full max-w-5xl px-6 py-4">
          <Sender
            value={input}
            onChange={(val) => setInput(val)}
            onSubmit={handleSubmit}
            onCancel={abort}
            loading={isRequesting}
            placeholder="输入内容，Enter 发送，Shift+Enter 换行"
            autoSize={{ minRows: 2, maxRows: 6 }}
          />
        </div>
      </footer>
    </div>
  );
}
