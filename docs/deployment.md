# Deployment

## Vercel

1. Import this repository into Vercel.
2. Set environment variables in Vercel project settings.
3. Deploy.

Routing:

- `/api/chat` runs on Edge Runtime.
- `/api/history` runs on Node Runtime.

## Self-hosted

```bash
pnpm build
pnpm start
```

Ensure the environment variables are set in your host environment.

## Notes

- File-based storage is for development. Use a database for production.
- Edge Runtime does not allow Node APIs, so session storage is split into Node Runtime route.
