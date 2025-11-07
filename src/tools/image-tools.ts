/**
 * MCP Tool Implementations for Image Generator v3
 * Uses standard @modelcontextprotocol/sdk patterns (no custom wrappers)
 */

import { z } from 'zod'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type {
  Env,
  GenerationJob,
  Generation,
  ImageGenerationMessage
} from '../types.js'

// Zod schemas for tool input validation
const GenerateImageSchema = z.object({
  prompt: z.string().min(3, 'Prompt must be at least 3 characters').max(1000, 'Prompt must be under 1000 characters'),
  model: z.enum(['flux-schnell', 'sdxl-lightning', 'sdxl-base']).optional().default('flux-schnell')
})

const GetJobStatusSchema = z.object({
  job_id: z.string().min(1, 'Job ID is required')
})

const ListGenerationsSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(10),
  offset: z.number().int().min(0).optional().default(0)
})

const ListJobsSchema = z.object({
  status: z.enum(['all', 'pending', 'processing', 'completed', 'failed']).optional().default('all'),
  limit: z.number().int().min(1).max(50).optional().default(10),
  offset: z.number().int().min(0).optional().default(0)
})

/**
 * Register all MCP tools with the server
 */
export function registerImageTools(server: Server, env: Env) {

  // Register tools/call handler for all 4 tools
  server.setRequestHandler('tools/call', async (request) => {
    const toolName = request.params.name

    try {
      // Tool 1: generate_image
      if (toolName === 'generate_image') {
        const args = GenerateImageSchema.parse(request.params.arguments)

        try {
          // Generate unique job ID
          const jobId = crypto.randomUUID()
          const now = Date.now()

          // Create job record in D1
          await env.DB.prepare(`
            INSERT INTO generation_jobs (id, status, prompt, model, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(jobId, 'pending', args.prompt, args.model, now, now).run()

          // Send message to Queue for async processing
          const message: ImageGenerationMessage = {
            jobId,
            prompt: args.prompt,
            model: args.model
          }
          await env.IMAGE_QUEUE.send(message)

          // Return immediately with job ID
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                job_id: jobId,
                status: 'pending',
                message: 'Image generation started. Use get_job_status to check progress.',
                prompt: args.prompt,
                model: args.model,
                estimated_time_seconds: 30
              }, null, 2)
            }]
          }
        } catch (error) {
          console.error('generate_image error:', error)
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }],
            isError: true
          }
        }
      }

      // Tool 2: get_job_status
      if (toolName === 'get_job_status') {
        const args = GetJobStatusSchema.parse(request.params.arguments)

        try {
          const result = await env.DB.prepare(`
            SELECT * FROM generation_jobs WHERE id = ?
          `).bind(args.job_id).first<GenerationJob>()

          if (!result) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Job not found',
                  job_id: args.job_id
                }, null, 2)
              }],
              isError: true
            }
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                job_id: result.id,
                status: result.status,
                image_url: result.image_url,
                error: result.error,
                prompt: result.prompt,
                model: result.model,
                created_at: result.created_at,
                updated_at: result.updated_at
              }, null, 2)
            }]
          }
        } catch (error) {
          console.error('get_job_status error:', error)
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }],
            isError: true
          }
        }
      }

      // Tool 3: list_generations
      if (toolName === 'list_generations') {
        const args = ListGenerationsSchema.parse(request.params.arguments)

        try {
          // Get total count
          const countResult = await env.DB.prepare(`
            SELECT COUNT(*) as total FROM generations
          `).first<{ total: number }>()
          const totalCount = countResult?.total || 0

          // Get paginated results
          const results = await env.DB.prepare(`
            SELECT * FROM generations
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
          `).bind(args.limit, args.offset).all<Generation>()

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                total_count: totalCount,
                returned_count: results.results.length,
                has_more: args.offset + results.results.length < totalCount,
                limit: args.limit,
                offset: args.offset,
                generations: results.results.map(g => ({
                  id: g.id,
                  job_id: g.job_id,
                  image_url: g.image_url,
                  prompt: g.prompt,
                  model: g.model,
                  created_at: g.created_at
                }))
              }, null, 2)
            }]
          }
        } catch (error) {
          console.error('list_generations error:', error)
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }],
            isError: true
          }
        }
      }

      // Tool 4: list_jobs
      if (toolName === 'list_jobs') {
        const args = ListJobsSchema.parse(request.params.arguments)

        try {
          // Build query with optional status filter
          const whereClause = args.status === 'all' ? '' : 'WHERE status = ?'
          const bindings = args.status === 'all' ? [] : [args.status]

          // Get total count
          const countResult = await env.DB.prepare(`
            SELECT COUNT(*) as total FROM generation_jobs ${whereClause}
          `).bind(...bindings).first<{ total: number }>()
          const totalCount = countResult?.total || 0

          // Get paginated results
          const results = await env.DB.prepare(`
            SELECT * FROM generation_jobs ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
          `).bind(...bindings, args.limit, args.offset).all<GenerationJob>()

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                filter: args.status,
                total_count: totalCount,
                returned_count: results.results.length,
                has_more: args.offset + results.results.length < totalCount,
                limit: args.limit,
                offset: args.offset,
                jobs: results.results.map(j => ({
                  id: j.id,
                  status: j.status,
                  prompt: j.prompt,
                  model: j.model,
                  image_url: j.image_url,
                  error: j.error,
                  created_at: j.created_at,
                  updated_at: j.updated_at
                }))
              }, null, 2)
            }]
          }
        } catch (error) {
          console.error('list_jobs error:', error)
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }],
            isError: true
          }
        }
      }

      // Unknown tool
      throw new Error(`Unknown tool: ${toolName}`)

    } catch (error) {
      // Handle Zod validation errors and other errors
      console.error('Tool handler error:', error)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, null, 2)
        }],
        isError: true
      }
    }
  })

  // Register tools/list handler
  server.setRequestHandler('tools/list', async () => {
    return {
      tools: [
        {
          name: 'generate_image',
          description: 'Generate an image using AI (FLUX or SDXL models) and store in R2. Returns immediately with a job ID for async processing.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'Text description of the image to generate (3-1000 characters)'
              },
              model: {
                type: 'string',
                enum: ['flux-schnell', 'sdxl-lightning', 'sdxl-base'],
                description: 'AI model to use. flux-schnell is fastest (default), sdxl-lightning is fast, sdxl-base is highest quality',
                default: 'flux-schnell'
              }
            },
            required: ['prompt']
          }
        },
        {
          name: 'get_job_status',
          description: 'Check the status of an image generation job. Returns job details including status (pending/processing/completed/failed) and image URL when completed.',
          inputSchema: {
            type: 'object',
            properties: {
              job_id: {
                type: 'string',
                description: 'The job ID returned from generate_image'
              }
            },
            required: ['job_id']
          }
        },
        {
          name: 'list_generations',
          description: 'List successfully completed image generations with pagination. Returns most recent generations first.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Number of results to return (1-50, default: 10)',
                minimum: 1,
                maximum: 50,
                default: 10
              },
              offset: {
                type: 'number',
                description: 'Number of results to skip for pagination (default: 0)',
                minimum: 0,
                default: 0
              }
            }
          }
        },
        {
          name: 'list_jobs',
          description: 'List all image generation jobs with optional status filtering and pagination. Returns most recent jobs first.',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['all', 'pending', 'processing', 'completed', 'failed'],
                description: 'Filter by job status (default: all)',
                default: 'all'
              },
              limit: {
                type: 'number',
                description: 'Number of results to return (1-50, default: 10)',
                minimum: 1,
                maximum: 50,
                default: 10
              },
              offset: {
                type: 'number',
                description: 'Number of results to skip for pagination (default: 0)',
                minimum: 0,
                default: 0
              }
            }
          }
        }
      ]
    }
  })
}
