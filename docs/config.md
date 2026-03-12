# Configuration

## Environment Variables

Core settings:

- `DEEPSEEK_API_KEY` API key for DeepSeek
- `DEEPSEEK_BASE_URL` API base URL, default `https://api.deepseek.com`
- `DEEPSEEK_MODEL` default model id
- `APP_API_KEY` server-side auth token
- `AUTH_BYPASS` allow bypass in development only

Frontend settings:

- `NEXT_PUBLIC_APP_API_KEY` client key to access server routes
- `NEXT_PUBLIC_DEFAULT_MODEL` default model id
- `NEXT_PUBLIC_MODEL_OPTIONS` comma-separated model list
- `NEXT_PUBLIC_SESSION_STORAGE` `local` or `db`

Session storage:

- `SESSION_DB_PATH` folder for file-based store (Node Runtime)
- `MAX_STORED_MESSAGES` cap stored messages

Limits:

- `RATE_LIMIT_WINDOW_MS` window size
- `RATE_LIMIT_MAX` max requests per window
- `CONCURRENCY_MAX` max concurrent requests per IP
- `MAX_INPUT_CHARS` input size limit
- `MAX_COMPLETION_TOKENS` output token cap

## Recommended Defaults

- `AUTH_BYPASS=false` in production
- `CONCURRENCY_MAX=2`
- `RATE_LIMIT_MAX=60`
- `MAX_COMPLETION_TOKENS=1024`
