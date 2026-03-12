# Security and Cost Controls

## Authentication

- `APP_API_KEY` is required in production.
- Client sends `x-api-key` header using `NEXT_PUBLIC_APP_API_KEY`.
- `AUTH_BYPASS=true` should be used only in development.

## Rate Limits

- Per-IP rate limiting using in-memory counters.
- Tune `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX`.

## Concurrency Limits

- Per-IP concurrent request cap using in-memory counters.
- Tune `CONCURRENCY_MAX`.

## Input and Output Guards

- `MAX_INPUT_CHARS` caps user input size.
- `MAX_COMPLETION_TOKENS` caps model output tokens.

## Production Guidance

- Replace in-memory limits with Redis or a gateway in production.
- Replace file-based sessions with a real database.
