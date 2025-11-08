# MCP Image Generator

> AI-powered image generation MCP server built on Cloudflare Workers

[![Status](https://img.shields.io/badge/status-production-green)]() [![Version](https://img.shields.io/badge/version-3.0.0-blue)]() [![License](https://img.shields.io/badge/license-MIT-orange)]()

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jezweb/mcp-image-generator)

**Live Deployment**: [https://mcp-image-generator-v3.webfonts.workers.dev](https://mcp-image-generator-v3.webfonts.workers.dev)

## What is This?

An MCP (Model Context Protocol) server that gives AI assistants the ability to generate images using Cloudflare Workers AI. Built with a stateless architecture for instant startup and reliable operation.

### Key Features

- **6 MCP Tools** for image generation, status polling, and history browsing
- **3 AI Models**: FLUX Schnell (~7-10s), SDXL Lightning (~15-20s), SDXL Base (~30-45s)
- **Dual Transport**: HTTP for Better Chatbot + SSE for MCP Inspector
- **Wait Tools**: Synchronous tools with internal polling for AI clients without timing capabilities
- **Full-Size Images**: 1024x1024 PNG stored in R2 with public URLs
- **Job Tracking**: D1 database for status updates and historical queries
- **Async Processing**: Cloudflare Queues for reliable background job processing

## Architecture

```
Stateless Worker + D1 + Queues (NO Durable Objects)

┌─────────────────┐
│  MCP Client     │ (Better Chatbot, MCP Inspector, etc.)
└────────┬────────┘
         │
    ┌────▼─────┐
    │  Worker  │ (/mcp via HTTP, /sse via SSE)
    │  + MCP   │
    └────┬─────┘
         │
    ┌────▼──────────────────────────┐
    │   6 Tools Available:          │
    │   1. generate_image           │
    │   2. get_job_status           │
    │   3. list_generations         │
    │   4. list_jobs                │
    │   5. wait_for_completion      │ ← NEW: Internal polling
    │   6. generate_image_and_wait  │ ← NEW: One-call convenience
    └───────────────────────────────┘
         │
    ┌────▼────────┐
    │  D1 Database│ (Job tracking)
    └─────────────┘
         │
    ┌────▼────────┐
    │ Queue       │ (Async processing)
    └────┬────────┘
         │
    ┌────▼──────────┐
    │ Workers AI    │ (Image generation)
    │ + R2 Storage  │ (Public URLs)
    └───────────────┘
```

## Available Tools

### 1. `generate_image`
**Type**: Async (returns immediately with job_id)

Start an AI image generation job. Returns a job_id that you must poll with `get_job_status()`.

```json
{
  "prompt": "a cyberpunk city at night with neon lights",
  "model": "flux-schnell"  // optional: flux-schnell | sdxl-lightning | sdxl-base
}
```

**Returns**: `{ job_id: "uuid", status: "pending" }`

---

### 2. `get_job_status`
**Type**: Polling

Check the status of an image generation job. Poll every 3-5 seconds until status="completed".

```json
{
  "job_id": "abc123-def456-..."
}
```

**Returns**: Job details with status (pending/processing/completed/failed) and image_url when done.

---

### 3. `list_generations`
**Type**: Query

Browse successfully completed images (gallery view).

```json
{
  "limit": 10,   // optional (1-50, default: 10)
  "offset": 0    // optional (default: 0)
}
```

**Returns**: Array of completed generations with metadata, sorted by creation time (newest first).

---

### 4. `list_jobs`
**Type**: Query

List all jobs with optional status filtering (includes pending/processing/failed).

```json
{
  "status": "all",  // optional: all | pending | processing | completed | failed
  "limit": 10,      // optional (1-50, default: 10)
  "offset": 0       // optional (default: 0)
}
```

**Returns**: Array of jobs matching the filter.

---

### 5. `wait_for_completion` ✨ NEW
**Type**: Synchronous (blocks until done)

Wait for an image generation job to complete. Automatically polls every 3 seconds (up to 60 seconds). Use this when you don't have timing/sleep capabilities.

```json
{
  "job_id": "abc123-def456-..."
}
```

**Returns**: Complete image details or error (no manual polling needed).

---

### 6. `generate_image_and_wait` ✨ NEW
**Type**: Synchronous (one-call convenience)

**EASIEST WAY** - Generate an image and wait for completion in ONE call. Handles everything automatically.

```json
{
  "prompt": "a golden sunset over the ocean",
  "model": "flux-schnell"  // optional
}
```

**Returns**: Image URL when ready (~7-45 seconds depending on model).

---

## Quick Start

### For Better Chatbot Users

Add this MCP server to Better Chatbot:

```json
{
  "url": "https://mcp-image-generator-v3.webfonts.workers.dev/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_AUTH_TOKEN"
  }
}
```

Then ask the AI assistant:
- "Generate an image of a sunset" (uses `generate_image_and_wait`)
- "Show me my recent images" (uses `list_generations`)

### For MCP Inspector Users

```bash
npx @modelcontextprotocol/inspector \
  https://mcp-image-generator-v3.webfonts.workers.dev/sse \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

### For Developers

```bash
# Clone and install
git clone <repo-url>
cd mcp-image-generator-v3
npm install

# Set up environment
npx wrangler secret put AUTH_TOKEN

# Deploy
npm run deploy

# Test
curl -X POST https://mcp-image-generator-v3.webfonts.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Project Structure

```
mcp-image-generator-v3/
├── wrangler.jsonc          # Worker config (D1, Queue, R2, AI)
├── src/
│   ├── index.ts            # Main worker with dual transport
│   ├── consumer.ts         # Queue consumer for async jobs
│   ├── mcp-handler.ts      # MCP HTTP protocol handler
│   ├── tools-http-wrapper.ts  # Tool implementations
│   ├── types.ts            # TypeScript interfaces
│   ├── lib/
│   │   ├── workers-ai.ts   # Workers AI integration
│   │   └── r2-storage.ts   # R2 uploads
│   └── tools/
│       └── image-tools.ts  # MCP SDK tool handlers (SSE)
├── migrations/
│   └── 0001_create_tables.sql  # D1 schema
└── docs/
    └── WAIT_TOOLS_IMPLEMENTATION.md  # Wait tools design doc
```

## Technology Stack

- **Cloudflare Workers** - Serverless compute (stateless architecture)
- **D1** - SQLite database for job tracking
- **Queues** - Async job processing with retry logic
- **R2** - Object storage for generated images (public URLs)
- **Workers AI** - GPU-accelerated image generation (FLUX, SDXL models)
- **MCP SDK** - Model Context Protocol for AI assistants
- **Hono** - Lightweight web framework
- **Zod** - Schema validation

## Why v3?

### The Problem with v1/v2 (Durable Objects)

v1 and v2 used Cloudflare Durable Objects for stateful MCP connections. This failed because:

- MCP initialization takes ~2+ minutes (handshake + tool registration)
- Durable Objects timeout after ~2 minutes of "inactivity" (IoContext timeout)
- Keep-alive mechanisms didn't solve the architectural mismatch
- DOs are designed for quick startup, not long initialization

### The v3 Solution (Stateless Workers)

v3 uses stateless Workers with proper async patterns:

✅ Workers initialize instantly (no timeout risk)
✅ MCP SDK works without custom wrappers
✅ Proper async via Queues (not ctx.waitUntil hacks)
✅ Simpler, more maintainable architecture
✅ Dual transport support (HTTP + SSE)
✅ Reuses 100% of AI/R2 logic from v2

## Wait Tools Enhancement

**Problem**: AI clients may not have `sleep()` or timing capabilities to poll `get_job_status()` every 3-5 seconds.

**Solution**: Added 2 synchronous tools with internal polling loops:

1. **`wait_for_completion`** - Polls every 3 seconds until job completes (60s timeout)
2. **`generate_image_and_wait`** - One-call convenience (generate + wait)

**Benefits**:
- No manual polling needed
- Works with ANY MCP client (no timing capabilities required)
- Industry-standard MCP async pattern
- Fits Cloudflare Workers constraints perfectly (I/O wait doesn't count against CPU limit)

## Configuration

### Bindings (wrangler.jsonc)

```jsonc
{
  "name": "mcp-image-generator-v3",
  "compatibility_date": "2024-11-07",
  "d1_databases": [
    { "binding": "DB", "database_name": "mcp-image-generator-db", "database_id": "..." }
  ],
  "queues": {
    "producers": [{ "binding": "IMAGE_QUEUE", "queue": "image-generation-queue" }],
    "consumers": [{ "queue": "image-generation-queue", "max_batch_size": 1 }]
  },
  "r2_buckets": [
    { "binding": "R2_BUCKET", "bucket_name": "mcp-r2-file-server" }
  ],
  "ai": { "binding": "AI" },
  "vars": { "AUTH_TOKEN": "..." }
}
```

### Environment Variables

- `AUTH_TOKEN` - Bearer token for authentication (set via `wrangler secret put AUTH_TOKEN`)

### Custom Domains

- **Worker**: imagemcp.jezweb.ai
- **R2 Bucket**: image.jezweb.ai

## Database Schema

```sql
-- generation_jobs: Track all image generation jobs
CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  image_url TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- generations: Historical archive of completed images
CREATE TABLE generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

## Testing

### Test All Tools

```bash
# List tools (should show 6)
curl -X POST https://mcp-image-generator-v3.webfonts.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Generate image and wait (easiest)
curl -X POST https://mcp-image-generator-v3.webfonts.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"generate_image_and_wait","arguments":{"prompt":"a golden sunset over the ocean","model":"flux-schnell"}}}'
```

### Test Async Pattern

```bash
# 1. Start generation (async)
JOB_ID=$(curl -X POST https://mcp-image-generator-v3.webfonts.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"generate_image","arguments":{"prompt":"a mountain landscape"}}}' \
  | jq -r '.result.content[0].text | fromjson | .job_id')

# 2. Wait for completion (sync)
curl -X POST https://mcp-image-generator-v3.webfonts.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"wait_for_completion\",\"arguments\":{\"job_id\":\"$JOB_ID\"}}}"
```

## Development

```bash
# Local development
npm run dev

# Deploy to Cloudflare
npm run deploy

# Run migrations
npx wrangler d1 migrations apply mcp-image-generator-db --remote

# View logs
npx wrangler tail
```

## Troubleshooting

### "Job not found" error
- Check that the job_id is correct
- Job may have expired (check `list_jobs` to see all jobs)

### "Timeout: Image generation took longer than 60 seconds"
- Try a faster model (flux-schnell instead of sdxl-base)
- Check Workers AI status
- Job may still complete - check with `get_job_status`

### Images are tiny/corrupted
- Fixed in v3.0.0 with proper Base64 decoding
- Workers AI returns Base64 strings, not raw bytes

### MCP Inspector timeout
- Use the SSE endpoint (`/sse`), not the HTTP endpoint (`/mcp`)
- Check that AUTH_TOKEN is correct
- Verify worker is deployed and running

## Contributing

This project demonstrates the correct architecture for MCP servers on Cloudflare Workers. Key lessons:

1. **Use stateless Workers, not Durable Objects** - DOs timeout during MCP initialization
2. **Use Queues for async processing** - Not `ctx.waitUntil()`
3. **Provide wait tools** - AI clients may not have timing capabilities
4. **Support dual transport** - HTTP for Better Chatbot, SSE for MCP Inspector
5. **Test incrementally** - Deploy after each phase

## License

MIT

## Related Projects

- **v1**: `/home/jez/Documents/mcp-cloudflare-image-generator` (Durable Objects - deprecated)
- **v2**: `/home/jez/Documents/mcp-cloudflare-image-generator-v2` (Durable Objects - deprecated)
- **Better Chatbot**: [Better Chatbot MCP Integration](https://www.better-auth.com)

## Credits

Built by [Jezweb](https://www.jezweb.com.au) using:
- Cloudflare Workers Platform
- Model Context Protocol (MCP)
- FLUX and Stable Diffusion XL models
