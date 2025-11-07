/**
 * MCP Request Handler for HTTP Transport
 * Handles MCP protocol messages over HTTP (JSON-RPC 2.0)
 *
 * This provides HTTP Streamable transport for Better Chatbot compatibility
 * Bypasses MCP SDK Server class to directly handle requests
 */

import type { Env } from './types.js'

export interface MCPRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: any
}

export interface MCPResponse {
  jsonrpc: '2.0'
  id?: string | number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

/**
 * Get tool definitions from the registered image tools
 */
function getToolsList() {
  return {
    tools: [
      {
        name: 'generate_image',
        description: 'ASYNC: Start AI image generation job(s). Returns IMMEDIATELY with job_id(s) - you MUST poll get_job_status() or use wait_for_completion() to get results. Supports PARALLEL generation via count parameter. Images stored in R2 with public URLs.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Detailed text description of the image(s) to generate (3-1000 characters). Be specific and descriptive. Example: "a cyberpunk city at night with neon lights reflecting on wet streets". Same prompt used for all images if count > 1.'
            },
            model: {
              type: 'string',
              enum: ['flux-schnell', 'sdxl-lightning', 'sdxl-base'],
              description: 'AI model selection - IMPORTANT TRADE-OFFS: "flux-schnell" = fastest (~7-10 sec), good quality, 1024x1024, RECOMMENDED for parallel generation (DEFAULT). "sdxl-lightning" = fast (~15-20 sec), high quality. "sdxl-base" = slowest (~30-45 sec), highest quality.',
              default: 'flux-schnell'
            },
            count: {
              type: 'number',
              description: 'PARALLEL GENERATION: Number of images to generate (1-20). All jobs start simultaneously and process in parallel. count=1 returns single job_id (backward compatible). count>1 returns array of job_ids. Use with FLUX for best performance. Default: 1',
              minimum: 1,
              maximum: 20,
              default: 1
            }
          },
          required: ['prompt']
        }
      },
      {
        name: 'get_job_status',
        description: 'Poll this repeatedly (every 3-5 seconds) after calling generate_image() to check job progress. Returns: status="pending" (queued), "processing" (generating), "completed" (done, image_url available), or "failed" (error in error field). CRITICAL: image_url is NULL until status="completed". Recommended: poll for up to 60 seconds, then assume failure if not completed.',
        inputSchema: {
          type: 'object',
          properties: {
            job_id: {
              type: 'string',
              description: 'The job_id string returned from generate_image(). Example: "e19e54bd-0ce9-4ea5-8379-e54ec241bba2"'
            }
          },
          required: ['job_id']
        }
      },
      {
        name: 'list_generations',
        description: 'Browse the gallery of successfully completed images. Only returns jobs with status="completed" that have image_url. Sorted by creation time (newest first). Use this to see your image history or find previously generated images.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'How many results to return per page (1-50). Default: 10. Use smaller values for quick lookups, larger for comprehensive browsing.',
              minimum: 1,
              maximum: 50,
              default: 10
            },
            offset: {
              type: 'number',
              description: 'Skip this many results (for pagination). Example: offset=10 with limit=10 gets results 11-20. Default: 0 (start from beginning).',
              minimum: 0,
              default: 0
            }
          }
        }
      },
      {
        name: 'list_jobs',
        description: 'View all image generation jobs with filtering. Unlike list_generations, this includes pending/processing/failed jobs. Useful for debugging, monitoring queue status, or finding jobs that failed. Sorted by creation time (newest first).',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['all', 'pending', 'processing', 'completed', 'failed'],
              description: 'Filter results by status: "all"=everything, "pending"=queued not started, "processing"=AI generating now, "completed"=done successfully, "failed"=error occurred (check error field). Default: "all"',
              default: 'all'
            },
            limit: {
              type: 'number',
              description: 'How many results to return per page (1-50). Default: 10.',
              minimum: 1,
              maximum: 50,
              default: 10
            },
            offset: {
              type: 'number',
              description: 'Skip this many results (for pagination). Example: offset=10 with limit=10 gets results 11-20. Default: 0.',
              minimum: 0,
              default: 0
            }
          }
        }
      },
      {
        name: 'wait_for_completion',
        description: 'SYNCHRONOUS: Wait for image generation job(s) to complete. Automatically polls every 3 seconds. Supports SINGLE or MULTIPLE jobs. Timeout scales with count (60s + 3s per job). Use when you don\'t have timing/sleep capabilities. Returns completed image URL(s) or error. NO manual polling needed.',
        inputSchema: {
          type: 'object',
          properties: {
            job_id: {
              type: 'string',
              description: 'Single job_id from generate_image(). Use this OR job_ids, not both.'
            },
            job_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of job_ids from generate_image() with count>1. Waits for ALL to complete. Use this OR job_id, not both. Max 20 jobs.',
              minItems: 1,
              maxItems: 20
            }
          },
          oneOf: [
            { required: ['job_id'] },
            { required: ['job_ids'] }
          ]
        }
      },
      {
        name: 'generate_image_and_wait',
        description: 'EASIEST: Generate image(s) and wait for completion in ONE call. Supports PARALLEL generation via count parameter. Handles everything automatically (generate + wait). Blocks until complete (timeout scales with count). Perfect for "generate N images" requests.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Detailed text description of the image(s) to generate (3-1000 characters). Same prompt used for all images if count > 1.'
            },
            model: {
              type: 'string',
              enum: ['flux-schnell', 'sdxl-lightning', 'sdxl-base'],
              description: 'AI model selection. flux-schnell = fastest (~7-10s), RECOMMENDED for parallel (DEFAULT). sdxl-lightning = fast (~15-20s). sdxl-base = slowest (~30-45s, highest quality)',
              default: 'flux-schnell'
            },
            count: {
              type: 'number',
              description: 'PARALLEL GENERATION: Number of images to generate (1-20). All process simultaneously. Timeout: 60s + 3s per image. Default: 1',
              minimum: 1,
              maximum: 20,
              default: 1
            }
          },
          required: ['prompt']
        }
      }
    ]
  }
}

/**
 * Handle MCP requests over HTTP (JSON-RPC 2.0)
 * Directly implements MCP protocol without SDK Server class
 */
export async function handleMCPRequest(
  request: MCPRequest,
  toolsCallHandler: (name: string, args: any) => Promise<any>
): Promise<MCPResponse> {
  const { id, method, params } = request

  try {
    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'mcp-image-generator',
              version: '3.0.0'
            },
            capabilities: {
              tools: {}
            }
          }
        }
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: getToolsList()
        }
      }

      case 'tools/call': {
        if (!params || !params.name) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: 'Invalid params: missing tool name'
            }
          }
        }

        const result = await toolsCallHandler(params.name, params.arguments || {})
        return {
          jsonrpc: '2.0',
          id,
          result
        }
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        }
    }
  } catch (error) {
    console.error('MCP request error:', error)
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error'
      }
    }
  }
}
