"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bubble, Sender, Welcome } from "@ant-design/x";
import { Button, Input, Select, Tag } from "antd";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

type SessionInfo = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  order?: number;
  hasMessages: boolean;
};

const SESSION_ID_KEY = "llmx:session_id";
const LOCAL_MESSAGES_PREFIX = "llmx:messages:";
const LOCAL_SESSIONS_KEY = "llmx:sessions";

function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  const existing = window.localStorage.getItem(SESSION_ID_KEY);
  if (existing) return existing;
  const next = window.crypto?.randomUUID?.() ?? `session_${Date.now()}`;
  window.localStorage.setItem(SESSION_ID_KEY, next);
  return next;
}

function ChatConversation({
  sessionId,
  storageMode,
  appApiKey,
  modelId,
  onRequestingChange,
  onMessagesPersisted,
  onHasMessagesChange
}: {
  sessionId: string;
  storageMode: string;
  appApiKey: string;
  modelId: string;
  onRequestingChange: (value: boolean) => void;
  onMessagesPersisted: (meta: { title: string; updatedAt: number }) => void;
  onHasMessagesChange: (value: boolean) => void;
}) {
  const [input, setInput] = useState("");

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
    conversationKey: sessionId,
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
      const raw = window.localStorage.getItem(`${LOCAL_MESSAGES_PREFIX}${sessionId}`);
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

  useEffect(() => {
    onRequestingChange(isRequesting);
  }, [isRequesting, onRequestingChange]);

  useEffect(() => {
    onHasMessagesChange(messages.length > 0);
  }, [messages.length, onHasMessagesChange]);

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
  const persistKeyRef = useRef<string>("");
  const initialLoadedCountRef = useRef<number | null>(null);
  const lastPersistedMsgRef = useRef<{ id?: string | number; status?: string }>({});

  useEffect(() => {
    const payload: StoredMessage[] = messages.map((item) => ({
      id: item.id,
      status: item.status,
      message: item.message,
      extraInfo: item.extraInfo
    }));

    const deriveTitle = () => {
      const firstUser = messages.find((msg) => msg.message?.role === "user");
      const content =
        typeof firstUser?.message?.content === "string"
          ? firstUser?.message?.content
          : firstUser?.message?.content?.text || "新对话";
      return content.trim().slice(0, 24) || "新对话";
    };

    if (messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    if (initialLoadedCountRef.current === null) {
      initialLoadedCountRef.current = messages.length;
      lastPersistedMsgRef.current = { id: lastMsg?.id, status: lastMsg?.status };
      return;
    }

    if (lastMsg?.status === "updating" || lastMsg?.status === "loading") {
      return;
    }

    const lastPersisted = lastPersistedMsgRef.current;
    const isNewMessage = lastMsg?.id !== lastPersisted.id;
    const isTerminalStatus =
      lastMsg?.status === "success" ||
      lastMsg?.status === "error" ||
      lastMsg?.status === "abort" ||
      lastMsg?.status === "local";

    if (!isNewMessage && lastMsg?.status === lastPersisted.status) {
      return;
    }

    if (!isTerminalStatus) return;

    const persistKey = `${messages.length}:${lastMsg?.id}:${lastMsg?.status}`;
    if (persistKeyRef.current === persistKey) return;
    persistKeyRef.current = persistKey;
    lastPersistedMsgRef.current = { id: lastMsg?.id, status: lastMsg?.status };

    const updatedAt = Date.now();
    const title = deriveTitle();
    onMessagesPersisted({ title, updatedAt });

    if (storageMode === "db") {
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = setTimeout(() => {
        fetch("/api/history", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(appApiKey ? { "x-api-key": appApiKey } : {})
          },
          body: JSON.stringify({
            sessionId,
            messages: payload,
            title
          })
        }).catch(() => {});
      }, 500);
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(`${LOCAL_MESSAGES_PREFIX}${sessionId}`, JSON.stringify(payload));
    }
  }, [messages, storageMode, sessionId, appApiKey, onMessagesPersisted]);

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
    <>
      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <Welcome title="欢迎使用 LLMX" description="开箱即用的 DeepSeek SSE 模板" />
        </div>
      ) : (
        <Bubble.List
          className="h-full overflow-y-auto rounded-2xl bg-white/80 p-4 shadow-sm"
          role={roleConfig}
          items={items}
          autoScroll
        />
      )}
      <div className="mt-4">
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
    </>
  );
}

function SortableSessionItem({
  item,
  active,
  disabled,
  onSelect,
  onEdit,
  onDelete
}: {
  item: SessionInfo;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-start justify-between rounded-lg px-3 py-2 text-left text-xs transition ${
        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      <button type="button" onClick={onSelect} className="flex-1 text-left" disabled={disabled}>
        <div>{item.title}</div>
        <div className="mt-1 text-[10px] opacity-70">
          {new Date(item.updatedAt ?? item.createdAt).toLocaleString()}
        </div>
      </button>
      <button
        type="button"
        aria-label="拖拽排序"
        className={`ml-2 rounded px-1 text-[10px] transition ${
          active ? "text-white/80 hover:text-white" : "text-slate-400 hover:text-slate-700"
        }`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        拖拽
      </button>
      <button
        type="button"
        aria-label="编辑标题"
        className={`ml-2 rounded px-1 text-[10px] transition ${
          active ? "text-white/80 hover:text-white" : "text-slate-400 hover:text-slate-700"
        }`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
        disabled={disabled}
      >
        编辑
      </button>
      <button
        type="button"
        aria-label="删除会话"
        className={`ml-2 rounded px-1 text-[10px] transition ${
          active ? "text-white/80 hover:text-white" : "text-slate-400 hover:text-slate-700"
        }`}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        disabled={disabled}
      >
        删除
      </button>
    </div>
  );
}

export default function ChatClient() {
  const { modelId, setModelId } = useModelStore();
  const [sessionId, setSessionId] = useState(() => getSessionId());
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [isRequesting, setIsRequesting] = useState(false);
  const [currentHasMessages, setCurrentHasMessages] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const storageMode = process.env.NEXT_PUBLIC_SESSION_STORAGE || "db";
  const appApiKey = process.env.NEXT_PUBLIC_APP_API_KEY || "";

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (storageMode !== "db") return;

    fetch("/api/sessions", {
      headers: appApiKey ? { "x-api-key": appApiKey } : undefined
    })
      .then((resp) => (resp.ok ? resp.json() : { sessions: [] }))
      .then(async (data: { sessions?: SessionInfo[] }) => {
        const list = data.sessions ?? [];
        if (list.length === 0) {
          const created = await fetch("/api/sessions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(appApiKey ? { "x-api-key": appApiKey } : {})
            },
            body: JSON.stringify({ title: "新对话" })
          }).then((resp) => (resp.ok ? resp.json() : null));

          if (created?.sessionId) {
            const now = Date.now();
            const nextSession: SessionInfo = {
              id: created.sessionId,
              title: "新对话",
              createdAt: now,
              updatedAt: undefined,
              order: 1,
              hasMessages: false
            };
            setSessions([nextSession]);
            setSessionId(created.sessionId);
            if (typeof window !== "undefined") {
              window.localStorage.setItem(SESSION_ID_KEY, created.sessionId);
            }
            return;
          }
        }

        setSessions(list);
        if (list.length > 0 && !list.find((item) => item.id === sessionId)) {
          setSessionId(list[0].id);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(SESSION_ID_KEY, list[0].id);
          }
        }
      })
      .catch(() => {});
  }, [storageMode, appApiKey, sessionId]);

  const handleNewSession = async () => {
    if (isRequesting) return;
    const emptySession = sessions.find((item) => !item.hasMessages);
    if (emptySession && emptySession.id !== sessionId) {
      setSessionId(emptySession.id);
      window.localStorage.setItem(SESSION_ID_KEY, emptySession.id);
      return;
    }
    if (!currentHasMessages) return;
    if (storageMode !== "db") return;

    const resp = await fetch("/api/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(appApiKey ? { "x-api-key": appApiKey } : {})
      },
      body: JSON.stringify({ title: "新对话" })
    }).catch(() => null);

    const data = resp && resp.ok ? ((await resp.json()) as { sessionId?: string }) : null;
    if (!data?.sessionId) return;

    const createdAt = Date.now();
    const nextList = [
      {
        id: data.sessionId,
        title: "新对话",
        createdAt,
        updatedAt: undefined,
        order: 1,
        hasMessages: false
      },
      ...sessions
    ];
    setSessions(nextList);
    await fetch("/api/sessions", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(appApiKey ? { "x-api-key": appApiKey } : {})
      },
      body: JSON.stringify({ order: nextList.map((item) => item.id) })
    }).catch(() => {});
    setSessionId(data.sessionId);
    window.localStorage.setItem(SESSION_ID_KEY, data.sessionId);
  };

  const handlePersistedMeta = useCallback(
    (meta: { title: string; updatedAt: number }) => {
      setSessions((prev) => {
        const next = prev.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                title: meta.title,
                createdAt: item.createdAt ?? meta.updatedAt,
                updatedAt: meta.updatedAt,
                hasMessages: true
              }
            : item
        );
        if (storageMode === "local" && typeof window !== "undefined") {
          window.localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(next));
        }
        return next;
      });
    },
    [sessionId, storageMode]
  );

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
        <div className="mx-auto flex h-full w-full max-w-6xl gap-4 px-6 py-6">
          <aside className="hidden h-full w-60 flex-col rounded-2xl bg-white/80 p-4 shadow-sm md:flex">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">会话</div>
              <Button size="small" onClick={handleNewSession} disabled={isRequesting}>
                新建
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
                {sessions.length === 0 ? (
                  <div className="text-xs text-slate-400">暂无会话</div>
                ) : (
                  <div className="flex flex-col gap-2">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={async (event) => {
                      if (isRequesting) return;
                      const { active, over } = event;
                      if (!over || active.id === over.id) return;
                      const oldIndex = sessions.findIndex((item) => item.id === active.id);
                      const newIndex = sessions.findIndex((item) => item.id === over.id);
                      if (oldIndex < 0 || newIndex < 0) return;
                      const next = arrayMove(sessions, oldIndex, newIndex);
                      setSessions(next);
                      if (storageMode === "db") {
                        await fetch("/api/sessions", {
                          method: "PATCH",
                          headers: {
                            "Content-Type": "application/json",
                            ...(appApiKey ? { "x-api-key": appApiKey } : {})
                          },
                          body: JSON.stringify({ order: next.map((item) => item.id) })
                        }).catch(() => {});
                      } else if (typeof window !== "undefined") {
                        window.localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(next));
                      }
                    }}
                  >
                    <SortableContext
                      items={sessions.map((item) => item.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="flex flex-col gap-2">
                        {sessions.map((item) => (
                          <SortableSessionItem
                            key={item.id}
                            item={item}
                            active={item.id === sessionId}
                            disabled={isRequesting}
                            onSelect={() => {
                              if (isRequesting) return;
                              setSessionId(item.id);
                              window.localStorage.setItem(SESSION_ID_KEY, item.id);
                            }}
                            onEdit={() => {
                              if (isRequesting) return;
                              setEditingSessionId(item.id);
                              setEditingTitle(item.title);
                            }}
                            onDelete={async () => {
                              if (isRequesting) return;
                              if (!confirm("确定删除该会话？")) return;
                              if (storageMode === "db") {
                                await fetch(`/api/sessions?sessionId=${encodeURIComponent(item.id)}`,
                                  {
                                    method: "DELETE",
                                    headers: appApiKey ? { "x-api-key": appApiKey } : undefined
                                  }
                                ).catch(() => {});
                              } else if (typeof window !== "undefined") {
                                window.localStorage.removeItem(`${LOCAL_MESSAGES_PREFIX}${item.id}`);
                              }

                              const nextList = sessions.filter((session) => session.id !== item.id);
                              setSessions(nextList);
                              if (storageMode === "db") {
                                await fetch("/api/sessions", {
                                  method: "PATCH",
                                  headers: {
                                    "Content-Type": "application/json",
                                    ...(appApiKey ? { "x-api-key": appApiKey } : {})
                                  },
                                  body: JSON.stringify({ order: nextList.map((session) => session.id) })
                                }).catch(() => {});
                              } else if (typeof window !== "undefined") {
                                window.localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(nextList));
                              }

                              if (item.id === sessionId) {
                                const fallback = nextList[0];
                                if (fallback) {
                                  setSessionId(fallback.id);
                                  window.localStorage.setItem(SESSION_ID_KEY, fallback.id);
                                  return;
                                }

                                if (storageMode === "db") {
                                  const created = await fetch("/api/sessions", {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      ...(appApiKey ? { "x-api-key": appApiKey } : {})
                                    },
                                    body: JSON.stringify({ title: "新对话" })
                                  }).then((resp) => (resp.ok ? resp.json() : null));

                                  if (created?.sessionId) {
                                    const createdAt = Date.now();
                                    setSessions((prev) => [
                                      {
                                        id: created.sessionId,
                                        title: "新对话",
                                        createdAt,
                                        updatedAt: undefined,
                                        order: 1,
                                        hasMessages: false
                                      },
                                      ...prev
                                    ]);
                                    setSessionId(created.sessionId);
                                    window.localStorage.setItem(SESSION_ID_KEY, created.sessionId);
                                    return;
                                  }
                                }
                              }
                            }}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              )}
            </div>
          </aside>
          <div className="flex h-full flex-1 flex-col">
            {editingSessionId ? (
              <div className="mb-3 rounded-xl bg-white/80 p-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <Input
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    maxLength={32}
                  />
                  <Button
                    type="primary"
                    disabled={isRequesting || editingTitle.trim().length === 0}
                    onClick={async () => {
                      const title = editingTitle.trim();
                      const targetId = editingSessionId;
                      if (!title || !targetId) return;
                      await fetch("/api/sessions", {
                        method: "PATCH",
                        headers: {
                          "Content-Type": "application/json",
                          ...(appApiKey ? { "x-api-key": appApiKey } : {})
                        },
                        body: JSON.stringify({ sessionId: targetId, title })
                      }).catch(() => {});

                      setSessions((prev) =>
                        prev.map((session) =>
                          session.id === targetId ? { ...session, title } : session
                        )
                      );
                      setEditingSessionId(null);
                      setEditingTitle("");
                    }}
                  >
                    保存
                  </Button>
                  <Button
                    onClick={() => {
                      setEditingSessionId(null);
                      setEditingTitle("");
                    }}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : null}
            <ChatConversation
              key={sessionId}
              sessionId={sessionId}
              storageMode={storageMode}
              appApiKey={appApiKey}
              modelId={modelId}
              onRequestingChange={setIsRequesting}
              onMessagesPersisted={handlePersistedMeta}
              onHasMessagesChange={setCurrentHasMessages}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
