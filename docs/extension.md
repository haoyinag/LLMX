# Extension Guide

This template is designed to be extended quickly for different products.

## Replace the Model Provider

- Edit `src/app/api/chat/route.ts` and change the upstream URL and payload.
- Keep the response as SSE so the frontend can stream.
- Update `NEXT_PUBLIC_MODEL_OPTIONS` for the UI.

## Add a Real Database

- Replace `src/app/api/history/route.ts` with your database implementation.
- Suggested fields: `sessionId`, `messages`, `updatedAt`.
- Keep the API contract `{ sessionId, messages }` to avoid front-end changes.

## Add Auth

- Replace API key auth with JWT or OAuth.
- Use server-side verification in `/api/chat` and `/api/history`.
- Remove `AUTH_BYPASS` in production.

## Observability

- Add request logging in `/api/chat`.
- Track rate limit hits and upstream errors.
- Export basic metrics to your monitoring stack.
