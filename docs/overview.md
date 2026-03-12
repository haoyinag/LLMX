# LLMX Overview

LLMX is a Next.js 15 App Router full-stack template for AI chat. The frontend uses Ant Design X and Zustand. The backend uses Edge Runtime for streaming and a Node Runtime route for optional session persistence.

## Architecture

- `src/app` App Router pages and API routes
- `/api/chat` Edge Runtime streaming proxy to DeepSeek
- `/api/history` Node Runtime file-based session store
- Frontend chat state managed by `useXChat` and streamed via SSE

## Request Flow

1. User submits input from `ChatClient`.
2. `/api/chat` validates auth and limits, forwards request to DeepSeek with streaming enabled.
3. Client receives streaming chunks and renders Markdown as they arrive.
4. Messages are persisted locally or via `/api/history` depending on `NEXT_PUBLIC_SESSION_STORAGE`.

## Storage Modes

- `local` stores messages in browser localStorage.
- `db` stores messages on server using a file-based store. Replace with a database for production.
