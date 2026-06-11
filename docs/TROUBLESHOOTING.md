# Troubleshooting

## Common Errors

| Error | Likely Cause | Solution |
|-------|-------------|---------|
| `API error 401: Unauthorized` | PROXY_TOKEN mismatch between backend/.env and frontend/.env | Ensure both files have identical PROXY_TOKEN values. Restart both servers. |
| `API error 401: OpenAI invalid_api_key` | Wrong or expired OpenAI key | Generate a new key at https://platform.openai.com/api-keys. Check for system-level env var override: run `[System.Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "User")` in PowerShell. |
| `KEY: undefined` in dotenv check | dotenv loading wrong .env path | Ensure `backend/.env` exists (not just `.env.example`). Use `override: true` in dotenv config. |
| `'vite' is not recognized` | Frontend node_modules not installed | Run `cd frontend && npm install` |
| `MODULE_NOT_FOUND: iconv-lite` | Corrupted node_modules | Run `cd backend && rmdir /s /q node_modules && npm cache clean --force && npm install` |
| `Port 3001 already in use` | Another process using port | Change `PORT=3002` in `backend/.env` and update `vite.config.ts` proxy target |
| `Rate limit exceeded` | Too many API calls per minute | Wait 60 seconds. The proxy limits to 60 req/min. For parallel phases, the staggered queue adds 1.5s between agents. |
| IndexedDB quota exceeded | Too many large projects stored | Export old projects (Dashboard → Export), delete them, then re-import if needed. |
| `Version conflict` | Concurrent edits to same project | Refresh the page. The last save wins (optimistic concurrency). |
| Decryption failed | Session passphrase changed (page reload) | Integration credentials use a session-scoped passphrase. Re-enter credentials after page reload. |

## Verifying the Setup

```bash
# Check backend is running
curl http://localhost:3001/health

# Check API key loaded
cd backend
node -e "require('dotenv').config({ path: '.env', override: true }); console.log(process.env.OPENAI_API_KEY?.slice(0,12))"
```

## Pipeline Stuck / Not Progressing

1. Open browser DevTools → Console — check for errors
2. Check backend terminal — each agent call logs `📤 [#N]` and `✅ [#N]`
3. If an agent errored, click it in the left panel to see the error message
4. Click **Resume Pipeline** to retry from the last failed agent

## Docker Issues

```bash
# Rebuild image from scratch
docker-compose -f docker/docker-compose.yml down
docker rmi agentic-sdlc
docker-compose -f docker/docker-compose.yml up --build
```
