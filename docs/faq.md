# FAQ

## Why does the API return 500?

Most often `DEEPSEEK_API_KEY` is missing or invalid. Check server logs and response body.

## Why is there no database?

The template ships with a file-based store for local use. Swap `/api/history` to your database of choice.

## Can I use another model provider?

Yes. Replace the request target in `/api/chat` and adjust payload/response parsing as needed.

## Does it support streaming?

Yes. `/api/chat` proxies SSE and the frontend renders markdown incrementally.
