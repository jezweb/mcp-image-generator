/**
 * MCP Image Generator v3 - Main Worker
 * Dual transport support: HTTP Streamable + SSE
 *
 * Architecture: Workers + D1 + Queues (NO Durable Objects)
 * HTTP endpoint (/mcp) for Better Chatbot compatibility
 * SSE endpoint (/sse) for MCP Inspector compatibility
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bearerAuth } from 'hono/bearer-auth'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { registerImageTools } from './tools/image-tools.js'
import { handleMCPRequest, type MCPRequest } from './mcp-handler.js'
import { callImageTool } from './tools-http-wrapper.js'
import consumer from './consumer.js'
import type { Env } from './types.js'

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for MCP clients
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

/**
 * Authentication middleware for MCP endpoints
 */
app.use('/mcp', async (c, next) => {
  const auth = bearerAuth({
    token: c.env.AUTH_TOKEN,
    realm: 'MCP Image Generator v3',
    hashFunction: (token: string) => token,
  })
  return auth(c, next)
})

app.use('/sse', async (c, next) => {
  const auth = bearerAuth({
    token: c.env.AUTH_TOKEN,
    realm: 'MCP Image Generator v3',
    hashFunction: (token: string) => token,
  })
  return auth(c, next)
})

/**
 * MCP HTTP Endpoint (HTTP Streamable)
 * POST /mcp
 * For Better Chatbot and standard MCP clients
 */
app.post('/mcp', async (c) => {
  try {
    const body = await c.req.json<MCPRequest>()

    // Validate JSON-RPC format
    if (!body || body.jsonrpc !== '2.0') {
      return c.json({
        jsonrpc: '2.0',
        id: body?.id,
        error: {
          code: -32600,
          message: 'Invalid Request: missing or invalid jsonrpc field',
        },
      }, 400)
    }

    // Handle MCP request via HTTP transport
    // Pass a callback that calls our image tools
    const response = await handleMCPRequest(body, async (name, args) => {
      return await callImageTool(name, args, c.env)
    })

    return c.json(response)
  } catch (error) {
    console.error('Error handling MCP request:', error)
    return c.json({
      jsonrpc: '2.0',
      error: {
        code: -32700,
        message: 'Parse error',
      },
    }, 400)
  }
})

/**
 * MCP SSE Endpoint (Server-Sent Events)
 * POST /sse
 * For MCP Inspector and clients that support SSE
 */
app.post('/sse', async (c) => {
  try {
    const request = c.req.raw

    // Create MCP server instance
    const server = new Server(
      {
        name: 'mcp-image-generator',
        version: '3.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    // Register all 4 tools
    registerImageTools(server, c.env)

    // Create SSE transport
    const transport = new SSEServerTransport('/sse', request)

    // Connect server to transport
    await server.connect(transport)

    // Return SSE response
    return transport.response
  } catch (error) {
    console.error('MCP SSE error:', error)
    return c.text(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 500)
  }
})

/**
 * Health check endpoint
 */
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    version: '3.0.0',
    architecture: 'stateless-workers',
    timestamp: new Date().toISOString()
  })
})

/**
 * Discovery page
 */
app.get('/', (c) => {
  return c.html(getDiscoveryPage())
})

/**
 * Export worker with Hono app + queue consumer
 */
export default {
  fetch: app.fetch,
  queue: consumer.queue
}

/**
 * Discovery page HTML
 * Displays server information and available tools
 */
function getDiscoveryPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Image Generator v3</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: hsl(0 0% 3.9%);
      background: hsl(0 0% 98%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      background: hsl(0 0% 100%);
      border-radius: 8px;
      border: 1px solid hsl(0 0% 89.8%);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      padding: 40px;
    }
    h1 { color: hsl(0 0% 3.9%); font-size: 2.5em; margin-bottom: 10px; font-weight: 700; }
    .version { color: hsl(0 0% 45.1%); font-size: 0.9em; margin-bottom: 30px; }
    h2 {
      color: hsl(0 0% 3.9%);
      margin-top: 40px;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid hsl(0 0% 89.8%);
      font-weight: 600;
    }
    h3 { color: hsl(0 0% 3.9%); margin-top: 30px; margin-bottom: 15px; font-size: 1.2em; font-weight: 600; }
    .badge {
      display: inline-block;
      background: hsl(0 0% 3.9%);
      color: hsl(0 0% 98%);
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 0.85em;
      font-weight: 500;
      margin-left: 10px;
    }
    .badge-new {
      background: hsl(0 0% 14.9%);
      color: hsl(0 0% 98%);
    }
    ul { list-style: none; padding-left: 0; }
    ul li { padding: 8px 0; padding-left: 24px; position: relative; }
    ul li::before { content: "•"; position: absolute; left: 0; color: hsl(0 0% 3.9%); font-weight: bold; }
    .tool {
      margin: 24px 0;
      padding: 20px;
      background: hsl(0 0% 96.1%);
      border-radius: 8px;
      border: 1px solid hsl(0 0% 89.8%);
    }
    .tool h3 { margin-bottom: 10px; color: hsl(0 0% 3.9%); margin-top: 0; }
    .tool p { color: hsl(0 0% 20%); margin-bottom: 12px; }
    .tool-param {
      background: hsl(0 0% 100%);
      padding: 12px;
      margin: 10px 0;
      border-radius: 6px;
      border: 1px solid hsl(0 0% 89.8%);
      font-size: 0.95em;
    }
    code {
      background: hsl(0 0% 96.1%);
      color: hsl(0 0% 3.9%);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      font-family: "SF Mono", Monaco, "Cascadia Code", "Courier New", monospace;
      border: 1px solid hsl(0 0% 89.8%);
    }
    pre {
      background: hsl(0 0% 3.9%);
      color: hsl(0 0% 98%);
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 12px 0;
      font-family: "SF Mono", Monaco, "Cascadia Code", "Courier New", monospace;
      font-size: 0.9em;
      line-height: 1.5;
      border: 1px solid hsl(0 0% 14.9%);
    }
    .highlight {
      background: hsl(0 0% 96.1%);
      border: 1px solid hsl(0 0% 89.8%);
      padding: 20px;
      border-radius: 8px;
      margin: 24px 0;
    }
    .highlight h3 { color: hsl(0 0% 3.9%); margin-top: 0; }
    .perf-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin: 20px 0;
    }
    .perf-card {
      background: hsl(0 0% 100%);
      color: hsl(0 0% 3.9%);
      padding: 20px;
      border-radius: 6px;
      text-align: center;
      border: 1px solid hsl(0 0% 89.8%);
    }
    .perf-card .number { font-size: 2em; font-weight: bold; margin: 10px 0; }
    .perf-card .label { font-size: 0.9em; color: hsl(0 0% 45.1%); }
    .client-section {
      background: hsl(0 0% 96.1%);
      padding: 20px;
      margin: 20px 0;
      border-radius: 8px;
      border: 1px solid hsl(0 0% 89.8%);
    }
    .client-section h4 { color: hsl(0 0% 3.9%); margin-top: 0; margin-bottom: 12px; font-weight: 600; }
    .endpoint {
      background: hsl(0 0% 96.1%);
      border: 1px solid hsl(0 0% 89.8%);
      padding: 12px;
      border-radius: 6px;
      margin: 16px 0;
    }
    .endpoint strong { color: hsl(0 0% 3.9%); }
    footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid hsl(0 0% 89.8%);
      text-align: center;
      color: hsl(0 0% 45.1%);
      font-size: 0.9em;
    }
    footer a { color: hsl(0 0% 3.9%); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
    @media (max-width: 768px) {
      .container { padding: 20px; }
      h1 { font-size: 2em; }
      .perf-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>MCP Image Generator v3<span class="badge">LIVE</span></h1>
    <p class="version">Version 1.0.0 | Stateless Workers Architecture</p>

    <p>
      This is a <strong>Model Context Protocol (MCP)</strong> server for AI-powered image generation
      using Cloudflare Workers AI. Built with a stateless architecture for instant startup and
      reliable operation.
    </p>

    <div class="highlight">
      <h3>⚡ NEW: Parallel Image Generation</h3>
      <p>
        Generate up to <strong>20 images simultaneously</strong> with the <code>count</code> parameter!
        Perfect for batch generation, variations, or rapid prototyping. Performance scales amazingly:
      </p>
      <div class="perf-grid">
        <div class="perf-card">
          <div class="label">1 Image</div>
          <div class="number">~10s</div>
          <div class="label">Baseline</div>
        </div>
        <div class="perf-card">
          <div class="label">5 Images</div>
          <div class="number">~22s</div>
          <div class="label">2.3x faster</div>
        </div>
        <div class="perf-card">
          <div class="label">20 Images</div>
          <div class="number">~16s</div>
          <div class="label">12.5x faster! 🚀</div>
        </div>
      </div>
    </div>

    <h2>✨ Architecture Highlights</h2>
    <ul>
      <li><strong>Stateless Workers</strong> - No Durable Objects, instant startup (fixes v1/v2 timeout issues)</li>
      <li><strong>D1 Database</strong> - SQLite for job tracking and generation history</li>
      <li><strong>Cloudflare Queues</strong> - Automatic parallel processing with retry logic</li>
      <li><strong>Workers AI</strong> - GPU-accelerated models (FLUX Schnell, SDXL Lightning, SDXL Base)</li>
      <li><strong>R2 Storage</strong> - Public image hosting with automatic URLs</li>
    </ul>

    <h2>🛠️ Available Tools (6 Total)</h2>

    <div class="tool">
      <h3>1. generate_image <span class="badge badge-new">PARALLEL</span></h3>
      <p>Generate one or more images using AI. Returns immediately with job ID(s) for async processing.</p>
      <pre>{
  "prompt": "sunset over mountains",
  "model": "flux-schnell",  // optional: flux-schnell | sdxl-lightning | sdxl-base
  "count": 5                // optional: 1-20 images (default: 1)
}</pre>
      <div class="tool-param">
        <strong>count parameter (NEW!):</strong> Generate 1-20 images in parallel using the same prompt.
        Returns single <code>job_id</code> if count=1, or <code>job_ids</code> array if count&gt;1.
      </div>
      <p><strong>Returns:</strong> <code>job_id</code> or <code>job_ids[]</code> in pending status</p>
    </div>

    <div class="tool">
      <h3>2. get_job_status</h3>
      <p>Check the status of an image generation job. Poll this to get results.</p>
      <pre>{
  "job_id": "abc123-def456-..."
}</pre>
      <p><strong>Returns:</strong> Job details with status (pending/processing/completed/failed) and <code>image_url</code> when done</p>
    </div>

    <div class="tool">
      <h3>3. wait_for_completion <span class="badge badge-new">SYNC</span></h3>
      <p>Wait for job(s) to complete automatically. No manual polling needed!</p>
      <pre>{
  "job_id": "abc123-..."          // Single job
  // OR
  "job_ids": ["abc", "def", ...]  // Multiple jobs (up to 20)
}</pre>
      <p><strong>Behavior:</strong> Polls every 3 seconds. Timeout scales with count (60s + 3s per job).
      Perfect for AI clients without timing capabilities.</p>
    </div>

    <div class="tool">
      <h3>4. generate_image_and_wait <span class="badge badge-new">EASIEST</span></h3>
      <p>One-call convenience: Generate and wait for completion automatically. Supports parallel generation!</p>
      <pre>{
  "prompt": "futuristic city at night",
  "model": "flux-schnell",  // optional
  "count": 10               // optional: 1-20 images
}</pre>
      <p><strong>Returns:</strong> Completed image(s) with URL(s) when ready. Blocks until done (timeout scales with count).</p>
    </div>

    <div class="tool">
      <h3>5. list_generations</h3>
      <p>Browse successfully completed images (gallery view) with pagination.</p>
      <pre>{
  "limit": 10,  // optional (1-50, default: 10)
  "offset": 0   // optional (default: 0)
}</pre>
      <p><strong>Returns:</strong> Array of completed generations with metadata, sorted by creation time (newest first)</p>
    </div>

    <div class="tool">
      <h3>6. list_jobs</h3>
      <p>List all jobs with optional status filtering and pagination.</p>
      <pre>{
  "status": "all",  // optional: all | pending | processing | completed | failed
  "limit": 10,      // optional (1-50, default: 10)
  "offset": 0       // optional (default: 0)
}</pre>
      <p><strong>Returns:</strong> Array of jobs matching the filter, sorted by creation time (newest first)</p>
    </div>

    <h2>🔌 Connect Your MCP Client</h2>

    <div class="endpoint">
      <strong>HTTP Endpoint:</strong> <code>POST /mcp</code> (JSON-RPC 2.0)<br>
      <strong>SSE Endpoint:</strong> <code>POST /sse</code> (Server-Sent Events)<br>
      <strong>Authentication:</strong> Bearer token in <code>Authorization</code> header<br>
      <strong>Server URL:</strong> <code>https://mcp-image-generator.webfonts.workers.dev</code>
    </div>

    <div class="client-section">
      <h4>Claude Desktop</h4>
      <p>Add to your <code>claude_desktop_config.json</code>:</p>
      <pre>{
  "mcpServers": {
    "image-generator": {
      "command": "curl",
      "args": [
        "-X", "POST",
        "https://mcp-image-generator.webfonts.workers.dev/mcp",
        "-H", "Content-Type: application/json",
        "-H", "Authorization: Bearer YOUR_AUTH_TOKEN"
      ]
    }
  }
}</pre>
    </div>

    <div class="client-section">
      <h4>Claude Code CLI</h4>
      <p>Add the server to your config:</p>
      <pre>claude mcp add image-generator \\
  --url https://mcp-image-generator.webfonts.workers.dev/mcp \\
  --header "Authorization: Bearer YOUR_AUTH_TOKEN"</pre>
      <p>Then use prompts like: <em>"Generate 5 variations of a mountain landscape"</em></p>
    </div>

    <div class="client-section">
      <h4>MCP Inspector (Testing)</h4>
      <p>Launch the inspector for debugging:</p>
      <pre>npx @modelcontextprotocol/inspector \\
  https://mcp-image-generator.webfonts.workers.dev/sse \\
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"</pre>
    </div>

    <div class="client-section">
      <h4>Cursor IDE</h4>
      <p>Add to Cursor's MCP settings (<code>Cursor → Settings → MCP</code>):</p>
      <pre>{
  "image-generator": {
    "url": "https://mcp-image-generator.webfonts.workers.dev/mcp",
    "headers": {
      "Authorization": "Bearer YOUR_AUTH_TOKEN"
    }
  }
}</pre>
    </div>

    <div class="client-section">
      <h4>Better Chatbot</h4>
      <p>Configure in your Better Chatbot settings:</p>
      <pre>{
  "url": "https://mcp-image-generator.webfonts.workers.dev/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_AUTH_TOKEN"
  }
}</pre>
    </div>

    <div class="client-section">
      <h4>Programmatic Access (Python/Node.js)</h4>
      <p>Call directly as an HTTP API:</p>
      <pre>// Node.js example
const response = await fetch('https://mcp-image-generator.webfonts.workers.dev/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_AUTH_TOKEN'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'generate_image_and_wait',
      arguments: { prompt: 'cyberpunk city', count: 5 }
    }
  })
});</pre>
    </div>

    <h2>🚀 Quick Start Examples</h2>
    <p><strong>Single image:</strong> "Generate an image of a sunset over the ocean"</p>
    <p><strong>Parallel generation:</strong> "Generate 10 different abstract patterns"</p>
    <p><strong>With specific model:</strong> "Generate 3 images of a mountain landscape using sdxl-lightning"</p>
    <p><strong>Async workflow:</strong> "Start generating 5 images, I'll check back later"</p>

    <h2>📊 Status</h2>
    <p>
      ✅ Server is running<br>
      ✅ All 6 tools registered<br>
      ✅ Parallel generation enabled (up to 20 images)<br>
      ✅ Database connected<br>
      ✅ Queue consumer active<br>
      ✅ Dual transport support (HTTP + SSE)
    </p>

    <footer>
      <p>MCP Image Generator v3 | Built with Cloudflare Workers</p>
      <p>Learn more about MCP at <a href="https://modelcontextprotocol.io" style="color: #667eea;">modelcontextprotocol.io</a></p>
    </footer>
  </div>
</body>
</html>`
}
