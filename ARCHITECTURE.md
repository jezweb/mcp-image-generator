# Architecture - MCP Image Generator v3

**Last Updated**: 2025-11-07
**Version**: 3.0 (Stateless Workers)

---

## Overview

Simplified MCP server architecture using stateless Cloudflare Workers with D1 database and Queues for async processing.

---

## Architecture Diagram

```
┌─────────────────┐
│   MCP Client    │ (Claude Desktop, BetterChat, etc.)
│  (HTTP/SSE)     │
└────────┬────────┘
         │
         │ POST /sse (with Bearer token)
         ↓
┌─────────────────────────────────────────────────────┐
│             Main Worker (stateless)                 │
│  • MCP SDK (standard, no custom wrapper)            │
│  • Bearer token authentication                      │
│  • 4 MCP Tools (generate_image, get_job_status,    │
│                 list_generations, list_jobs)        │
└─┬──────────────────────────────┬────────────────────┘
  │                              │
  │ Query D1                     │ Send to Queue
  ↓                              ↓
┌─────────────────┐     ┌──────────────────────┐
│   D1 Database   │     │   Cloudflare Queue   │
│                 │     │ (image-generation-   │
│ • Jobs table    │     │  queue)              │
│ • Generations   │     └──────────┬───────────┘
│   table         │                │
└─────────────────┘                │ Consumer
                                   ↓
                          ┌─────────────────────┐
                          │  Queue Consumer     │
                          │  Worker             │
                          │  • Process job      │
                          │  • Generate image   │
                          │  • Upload to R2     │
                          │  • Update D1        │
                          └─┬─────────────┬─────┘
                            │             │
                  Generate  │             │ Upload
                            ↓             ↓
                   ┌────────────┐  ┌──────────┐
                   │ Workers AI │  │    R2    │
                   │ (FLUX,     │  │  Bucket  │
                   │  SDXL)     │  │          │
                   └────────────┘  └──────────┘
                                        │
                                        │ Public URL
                                        ↓
                                   📷 Image
```

---

## Components

### 1. Main Worker (`src/index.ts`)

**Responsibilities**:
- Serve MCP protocol over SSE transport
- Authenticate requests (Bearer token)
- Handle 4 MCP tools:
  - `generate_image` - Create job in D1, submit to Queue
  - `get_job_status` - Query D1 for job status
  - `list_generations` - Query D1 for history
  - `list_jobs` - Query D1 with filters
- Serve discovery page at `/`

**Stack**:
- Standard `@modelcontextprotocol/sdk` (no custom wrapper)
- D1 for database queries
- Queue producer for async jobs

---

### 2. Queue Consumer (`src/consumer.ts`)

**Responsibilities**:
- Consume messages from `image-generation-queue`
- Generate images using Workers AI
- Upload to R2 with metadata
- Update job status in D1

**Flow**:
1. Receive job from queue (contains: jobId, prompt, model)
2. Call `generateImage()` from workers-ai.ts
3. Call `uploadImage()` from r2-storage.ts
4. Update D1: `UPDATE generation_jobs SET status='completed', image_url=?, updated_at=?`

---

### 3. D1 Database

**Tables**:

**`generation_jobs`** - Active/historical jobs
```sql
CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,        -- 'pending' | 'processing' | 'completed' | 'failed'
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  image_url TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**`generations`** - Historical archive (optional, for faster queries)
```sql
CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES generation_jobs(id)
);
```

---

### 4. Reusable Libraries (from v2)

**`src/lib/workers-ai.ts`** - Workers AI integration
- 3 model support (FLUX Schnell, SDXL Lightning, SDXL Base)
- Handles multiple response types
- Returns Uint8Array for R2 upload
- 100% reusable from v2

**`src/lib/r2-storage.ts`** - R2 uploads
- Automatic filename generation
- Custom metadata (prompt, model, timestamp)
- Returns public URL
- 100% reusable from v2

---

## Request Flow Examples

### Example 1: Generate Image

```
1. Client → Worker: generate_image("sunset over mountains", "flux-schnell")
2. Worker → D1: INSERT INTO generation_jobs (id, status='pending', ...)
3. Worker → Queue: Send {jobId, prompt, model}
4. Worker → Client: {"jobId": "abc123", "status": "pending"}

[Async]
5. Consumer ← Queue: Receive message
6. Consumer → Workers AI: Generate image
7. Consumer → R2: Upload image
8. Consumer → D1: UPDATE generation_jobs SET status='completed', image_url='...'
```

### Example 2: Check Status

```
1. Client → Worker: get_job_status("abc123")
2. Worker → D1: SELECT * FROM generation_jobs WHERE id='abc123'
3. Worker → Client: {"jobId": "abc123", "status": "completed", "imageUrl": "https://..."}
```

---

## Why This Architecture Works

**vs. Durable Objects (v1/v2)**:

| Aspect | DO Architecture (v2) | Stateless Architecture (v3) |
|--------|---------------------|----------------------------|
| Initialization | ~2+ minutes (timeout) | Instant |
| MCP SDK | Custom wrapper needed | Standard SDK works |
| State Management | DO internal SQLite | D1 database |
| Async Processing | ctx.waitUntil() | Proper Queues |
| Debugging | Hard (DO lifecycle) | Easy (standard Worker) |
| Scaling | DO limits | Natural (stateless) |

**Key Advantages**:
- ✅ No timeout issues
- ✅ Simpler codebase
- ✅ Standard Cloudflare patterns
- ✅ Better observability
- ✅ Easier to test

---

## Configuration

**Bindings** (wrangler.jsonc):
- `AI` - Workers AI
- `R2_BUCKET` - R2 storage (mcp-r2-file-server)
- `DB` - D1 database (mcp-image-generator-db)
- `IMAGE_QUEUE` - Queue producer

**Secrets**:
- `AUTH_TOKEN` - Bearer token for MCP authentication

**Queues**:
- `image-generation-queue` - Main queue
- `image-generation-dlq` - Dead letter queue (failed jobs)

---

## Security

**Authentication**: Bearer token on all MCP requests
**Authorization**: None (single-user for now)
**Rate Limiting**: Cloudflare's default (can add custom)
**CORS**: Not needed (server-to-server)

---

## Monitoring

**Cloudflare Dashboard**:
- Workers Analytics (request volume, errors)
- Queue Analytics (message throughput, processing time)
- D1 Analytics (query performance)
- R2 Analytics (storage usage)

**Logs**:
- `wrangler tail` for real-time logs
- Cloudflare Logpush for long-term storage

---

## Future Enhancements

**Potential Improvements**:
1. Add `cancel_job` tool (update status to 'cancelled')
2. Image metadata search (tags, descriptions)
3. Multiple output formats (PNG, JPEG, WebP)
4. Upscaling tool (use Workers AI upscaler)
5. Batch generation (multiple prompts)
6. User-specific auth (OAuth, API keys per user)

**Not Recommended**:
- ❌ Don't add Durable Objects back
- ❌ Don't use custom MCP wrappers
- ❌ Don't use ctx.waitUntil for critical logic
