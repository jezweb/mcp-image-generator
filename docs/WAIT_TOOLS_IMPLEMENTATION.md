# Wait Tools Implementation Plan

## Problem
AI clients using the MCP server may not have sleep/wait/timing capabilities to poll `get_job_status()` every 3-5 seconds. They rely on LLMs to remember to check back, which is unreliable.

## Solution
Add industry-standard MCP async tools that handle waiting internally with polling loops.

## New Tools (2 total)

### 1. `wait_for_completion(job_id)`
**Purpose**: Wait for a specific job to complete
**Pattern**: Internal polling loop (3-second intervals)
**Timeout**: 60 seconds
**Returns**: Complete image details or error
**CPU Time**: ~750ms (well under 30s limit)
**Wall Time**: 7-45 seconds (doesn't count against CPU limit)

### 2. `generate_image_and_wait(prompt, model)`
**Purpose**: One-shot image generation (easiest UX)
**Pattern**: Calls generate + wait_for_completion internally
**Returns**: Image URL when ready
**Best for**: Most users who want "just generate and give me the image"

## Files to Modify

### 1. `src/mcp-handler.ts`
Add 2 new tool definitions to `getToolsList()` function (after `list_jobs`, before closing `]`):

```typescript
{
  name: 'wait_for_completion',
  description: 'SYNCHRONOUS: Wait for an image generation job to complete. Automatically polls every 3 seconds until the image is ready (up to 60 seconds). Use this when you don\'t have timing/sleep capabilities. Returns the completed image URL or error. NO manual polling needed.',
  inputSchema: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The job_id from generate_image()'
      }
    },
    required: ['job_id']
  }
},
{
  name: 'generate_image_and_wait',
  description: 'EASIEST: Generate an image and wait for completion in ONE call. This is the simplest way to generate images - just provide a prompt and get back the image URL. Handles everything automatically (generate + wait). Blocks for 7-45 seconds depending on model.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed text description of the image to generate (3-1000 characters)'
      },
      model: {
        type: 'string',
        enum: ['flux-schnell', 'sdxl-lightning', 'sdxl-base'],
        description: 'AI model selection. flux-schnell = fastest (~7-10s), sdxl-lightning = fast (~15-20s), sdxl-base = slowest (~30-45s highest quality)',
        default: 'flux-schnell'
      }
    },
    required: ['prompt']
  }
}
```

### 2. `src/tools-http-wrapper.ts`
Add 2 new case statements in the `callImageTool()` switch (after `list_jobs`, before `default`):

```typescript
case 'wait_for_completion': {
  const params = z.object({ job_id: z.string() }).parse(args)

  const MAX_WAIT = 60000 // 60 seconds
  const POLL_INTERVAL = 3000 // 3 seconds
  const startTime = Date.now()

  while (Date.now() - startTime < MAX_WAIT) {
    const job = await env.DB.prepare(
      'SELECT * FROM generation_jobs WHERE id = ?'
    ).bind(params.job_id).first<GenerationJob>()

    if (!job) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Job not found' }) }],
        isError: true
      }
    }

    if (job.status === 'completed') {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true,
          status: 'completed',
          image_url: job.image_url,
          prompt: job.prompt,
          model: job.model
        }, null, 2) }]
      }
    }

    if (job.status === 'failed') {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: false,
          status: 'failed',
          error: job.error || 'Generation failed'
        }, null, 2) }],
        isError: true
      }
    }

    // Wait before next poll (doesn't count against CPU time)
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
  }

  // Timeout
  return {
    content: [{ type: 'text', text: JSON.stringify({
      success: false,
      error: 'Timeout: Image generation took longer than 60 seconds'
    }, null, 2) }],
    isError: true
  }
}

case 'generate_image_and_wait': {
  // First generate
  const genParams = GenerateImageSchema.parse(args)
  const jobId = crypto.randomUUID()
  const now = Date.now()

  await env.DB.prepare(`
    INSERT INTO generation_jobs (id, status, prompt, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(jobId, 'pending', genParams.prompt, genParams.model, now, now).run()

  await env.IMAGE_QUEUE.send({
    jobId,
    prompt: genParams.prompt,
    model: genParams.model
  })

  // Then wait (reuse wait logic)
  return await callImageTool('wait_for_completion', { job_id: jobId }, env)
}
```

## Implementation Steps

1. ✅ Create this planning doc
2. Compact context and resume
3. Add tool definitions to `src/mcp-handler.ts`
4. Add implementations to `src/tools-http-wrapper.ts`
5. Deploy to Cloudflare
6. Test both tools:
   - Test `wait_for_completion` with existing job
   - Test `generate_image_and_wait` end-to-end
7. Verify timeout behavior (optional)

## Testing Commands

```bash
# Test wait_for_completion
curl -X POST https://mcp-image-generator-v3.webfonts.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"wait_for_completion","arguments":{"job_id":"EXISTING_JOB_ID"}}}'

# Test generate_image_and_wait
curl -X POST https://mcp-image-generator-v3.webfonts.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"generate_image_and_wait","arguments":{"prompt":"a golden sunset over the ocean","model":"flux-schnell"}}}'
```

## Expected Results

- Tool count increases from 4 to 6 tools
- `generate_image_and_wait` returns image_url in ~7-45 seconds (single call)
- `wait_for_completion` polls and returns when job completes
- No LLM prompting needed to remember to check status
- Works with ANY MCP client (no timing capabilities required)

## Benefits

✅ Solves timing/polling problem for AI clients
✅ Industry-standard MCP async pattern
✅ Backward compatible (keeps existing tools)
✅ Best UX: one-call image generation
✅ Fits Cloudflare Workers constraints perfectly
✅ No architectural changes needed

## Notes

- The waiting time (7-45s) does NOT count against CPU time limit
- Only the database queries (~50ms each × 15 polls = 750ms) count
- Timeout at 60s prevents infinite loops
- Progress notifications not implemented (Better Chatbot uses HTTP, not SSE)
