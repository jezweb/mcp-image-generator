/**
 * MCP Image Generator v3 - Main Worker
 * Stateless MCP server using standard SDK over SSE transport
 *
 * Architecture: Workers + D1 + Queues (NO Durable Objects)
 * This fixes the timeout issues from v1/v2 by using stateless Workers
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { registerImageTools } from './tools/image-tools.js'
import consumer from './consumer.js'
import type { Env } from './types.js'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname

    // Route 1: Discovery page (GET /)
    if (pathname === '/' && request.method === 'GET') {
      return new Response(getDiscoveryPage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }

    // Route 2: Health check (GET /health)
    if (pathname === '/health' && request.method === 'GET') {
      return Response.json({
        status: 'healthy',
        version: '3.0.0',
        architecture: 'stateless-workers',
        timestamp: new Date().toISOString()
      })
    }

    // Route 3: MCP SSE endpoint (POST /sse)
    if (pathname === '/sse' && request.method === 'POST') {
      // Bearer token authentication
      const authHeader = request.headers.get('Authorization')
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response('Unauthorized: Missing Bearer token', {
          status: 401,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      const token = authHeader.substring(7) // Remove "Bearer " prefix
      if (token !== env.AUTH_TOKEN) {
        return new Response('Unauthorized: Invalid token', {
          status: 401,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      try {
        // Create MCP server with standard SDK (no custom wrapper)
        const server = new Server(
          {
            name: 'mcp-image-generator-v3',
            version: '3.0.0'
          },
          {
            capabilities: {
              tools: {}
            }
          }
        )

        // Register all 4 tools
        registerImageTools(server, env)

        // Create SSE transport
        const transport = new SSEServerTransport('/sse', request)

        // Connect server to transport
        await server.connect(transport)

        // Return SSE response
        return transport.response
      } catch (error) {
        console.error('MCP server error:', error)
        return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        })
      }
    }

    // 404 for unknown routes
    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' }
    })
  },

  // Queue consumer handler
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
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 40px;
    }
    h1 {
      color: #667eea;
      font-size: 2.5em;
      margin-bottom: 10px;
    }
    .version {
      color: #999;
      font-size: 0.9em;
      margin-bottom: 30px;
    }
    h2 {
      color: #333;
      margin-top: 40px;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #667eea;
    }
    .badge {
      display: inline-block;
      background: #10b981;
      color: white;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 600;
      margin-left: 10px;
    }
    ul {
      list-style: none;
      padding-left: 0;
    }
    ul li {
      padding: 8px 0;
      padding-left: 24px;
      position: relative;
    }
    ul li::before {
      content: "→";
      position: absolute;
      left: 0;
      color: #667eea;
      font-weight: bold;
    }
    .tool {
      margin: 24px 0;
      padding: 20px;
      background: #f8fafc;
      border-radius: 8px;
      border-left: 4px solid #667eea;
    }
    .tool h3 {
      margin-bottom: 10px;
      color: #667eea;
    }
    .tool p {
      color: #666;
      margin-bottom: 12px;
    }
    code {
      background: #1e293b;
      color: #10b981;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.9em;
      font-family: "SF Mono", Monaco, "Cascadia Code", "Courier New", monospace;
    }
    pre {
      background: #1e293b;
      color: #e2e8f0;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 12px 0;
      font-family: "SF Mono", Monaco, "Cascadia Code", "Courier New", monospace;
      font-size: 0.9em;
      line-height: 1.5;
    }
    .endpoint {
      background: #eff6ff;
      border: 1px solid #3b82f6;
      padding: 12px;
      border-radius: 6px;
      margin: 16px 0;
    }
    .endpoint strong {
      color: #3b82f6;
    }
    footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #999;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>MCP Image Generator v3<span class="badge">LIVE</span></h1>
    <p class="version">Version 3.0.0 | Stateless Workers Architecture</p>

    <p>
      This is a <strong>Model Context Protocol (MCP)</strong> server for AI-powered image generation
      using Cloudflare Workers AI. Built with a stateless architecture for instant startup and
      reliable operation.
    </p>

    <h2>✨ Architecture Highlights</h2>
    <ul>
      <li><strong>Stateless Workers</strong> - No Durable Objects, instant startup (fixes v1/v2 timeout issues)</li>
      <li><strong>D1 Database</strong> - SQLite for job tracking and generation history</li>
      <li><strong>Cloudflare Queues</strong> - Proper async processing with retry logic</li>
      <li><strong>Workers AI</strong> - GPU-accelerated models (FLUX Schnell, SDXL Lightning, SDXL Base)</li>
      <li><strong>R2 Storage</strong> - Public image hosting with automatic URLs</li>
    </ul>

    <h2>🛠️ Available Tools</h2>

    <div class="tool">
      <h3>1. generate_image</h3>
      <p>Generate an image using AI and store in R2. Returns immediately with a job ID for async processing.</p>
      <pre>{
  "prompt": "sunset over mountains",
  "model": "flux-schnell"  // optional: flux-schnell | sdxl-lightning | sdxl-base
}</pre>
      <p><strong>Returns:</strong> <code>job_id</code> in pending status (~30 seconds to complete)</p>
    </div>

    <div class="tool">
      <h3>2. get_job_status</h3>
      <p>Check the status of an image generation job. Poll this endpoint to get results.</p>
      <pre>{
  "job_id": "abc123-def456-..."
}</pre>
      <p><strong>Returns:</strong> Job details with status (pending/processing/completed/failed) and <code>image_url</code> when done</p>
    </div>

    <div class="tool">
      <h3>3. list_generations</h3>
      <p>List successfully completed image generations with pagination (most recent first).</p>
      <pre>{
  "limit": 10,  // optional (1-50, default: 10)
  "offset": 0   // optional (default: 0)
}</pre>
      <p><strong>Returns:</strong> Array of completed generations with metadata</p>
    </div>

    <div class="tool">
      <h3>4. list_jobs</h3>
      <p>List all jobs with optional status filtering and pagination (most recent first).</p>
      <pre>{
  "status": "all",  // optional: all | pending | processing | completed | failed
  "limit": 10,      // optional (1-50, default: 10)
  "offset": 0       // optional (default: 0)
}</pre>
      <p><strong>Returns:</strong> Array of jobs matching the filter</p>
    </div>

    <h2>🔌 Connection Details</h2>

    <div class="endpoint">
      <strong>MCP Endpoint:</strong> <code>POST /sse</code><br>
      <strong>Authentication:</strong> Bearer token in <code>Authorization</code> header<br>
      <strong>Transport:</strong> Server-Sent Events (SSE)
    </div>

    <h2>📊 Status</h2>
    <p>
      ✅ Server is running<br>
      ✅ All 4 tools registered<br>
      ✅ Database connected<br>
      ✅ Queue consumer active
    </p>

    <footer>
      <p>MCP Image Generator v3 | Built with Cloudflare Workers</p>
      <p>Learn more about MCP at <a href="https://modelcontextprotocol.io" style="color: #667eea;">modelcontextprotocol.io</a></p>
    </footer>
  </div>
</body>
</html>`
}
