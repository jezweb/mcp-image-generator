/**
 * HTTP Wrapper for Image Tools
 * Provides a simple function interface to call the tool handlers
 * that were originally designed for the MCP SDK Server class
 */

import { z } from 'zod'
import type { Env, GenerationJob, Generation, ImageGenerationMessage } from './types.js'

// Zod schemas (copied from image-tools.ts)
const GenerateImageSchema = z.object({
  prompt: z.string().min(3).max(1000),
  model: z.enum(['flux-schnell', 'sdxl-lightning', 'sdxl-base']).optional().default('flux-schnell'),
  count: z.number().int().min(1).max(20).optional().default(1)
})

const GetJobStatusSchema = z.object({
  job_id: z.string().min(1)
})

const WaitForCompletionSchema = z.union([
  z.object({ job_id: z.string() }),
  z.object({ job_ids: z.array(z.string()).min(1).max(20) })
])

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
 * Call image generation tools over HTTP
 * Returns the same format as the MCP SDK handlers
 */
export async function callImageTool(name: string, args: any, env: Env): Promise<any> {
  try {
    switch (name) {
      case 'generate_image': {
        const params = GenerateImageSchema.parse(args)
        const now = Date.now()
        const jobIds: string[] = []

        // Create multiple jobs if count > 1
        for (let i = 0; i < params.count; i++) {
          const jobId = crypto.randomUUID()
          jobIds.push(jobId)

          await env.DB.prepare(`
            INSERT INTO generation_jobs (id, status, prompt, model, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(jobId, 'pending', params.prompt, params.model, now, now).run()

          const message: ImageGenerationMessage = {
            jobId,
            prompt: params.prompt,
            model: params.model
          }
          await env.IMAGE_QUEUE.send(message)
        }

        // Single job: backward compatible response
        if (params.count === 1) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                job_id: jobIds[0],
                status: 'pending',
                message: 'Image generation started. Use get_job_status to check progress.',
                prompt: params.prompt,
                model: params.model,
                estimated_time_seconds: 30
              }, null, 2)
            }]
          }
        }

        // Multiple jobs: array response
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              job_ids: jobIds,
              count: params.count,
              status: 'pending',
              message: `${params.count} image generation jobs started. Use wait_for_completion with job_ids array to wait for all.`,
              prompt: params.prompt,
              model: params.model,
              estimated_time_seconds: 30
            }, null, 2)
          }]
        }
      }

      case 'get_job_status': {
        const params = GetJobStatusSchema.parse(args)
        const result = await env.DB.prepare(`
          SELECT * FROM generation_jobs WHERE id = ?
        `).bind(params.job_id).first<GenerationJob>()

        if (!result) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Job not found',
                job_id: params.job_id
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
      }

      case 'list_generations': {
        const params = ListGenerationsSchema.parse(args)

        const countResult = await env.DB.prepare(`
          SELECT COUNT(*) as total FROM generations
        `).first<{ total: number }>()
        const totalCount = countResult?.total || 0

        const results = await env.DB.prepare(`
          SELECT * FROM generations
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `).bind(params.limit, params.offset).all<Generation>()

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              total_count: totalCount,
              returned_count: results.results.length,
              has_more: params.offset + results.results.length < totalCount,
              limit: params.limit,
              offset: params.offset,
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
      }

      case 'list_jobs': {
        const params = ListJobsSchema.parse(args)

        const whereClause = params.status === 'all' ? '' : 'WHERE status = ?'
        const bindings = params.status === 'all' ? [] : [params.status]

        const countResult = await env.DB.prepare(`
          SELECT COUNT(*) as total FROM generation_jobs ${whereClause}
        `).bind(...bindings).first<{ total: number }>()
        const totalCount = countResult?.total || 0

        const results = await env.DB.prepare(`
          SELECT * FROM generation_jobs ${whereClause}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `).bind(...bindings, params.limit, params.offset).all<GenerationJob>()

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              filter: params.status,
              total_count: totalCount,
              returned_count: results.results.length,
              has_more: params.offset + results.results.length < totalCount,
              limit: params.limit,
              offset: params.offset,
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
      }

      case 'wait_for_completion': {
        const params = WaitForCompletionSchema.parse(args)

        // Determine if single or multiple jobs
        const isSingle = 'job_id' in params
        const jobIds = isSingle ? [params.job_id] : params.job_ids

        // Scaled timeout: 60s base + 3s per job
        const BASE_TIMEOUT = 60000
        const PER_JOB_TIMEOUT = 3000
        const MAX_WAIT = BASE_TIMEOUT + (jobIds.length * PER_JOB_TIMEOUT)
        const POLL_INTERVAL = 3000 // 3 seconds
        const startTime = Date.now()

        while (Date.now() - startTime < MAX_WAIT) {
          // Query all jobs
          const placeholders = jobIds.map(() => '?').join(',')
          const jobs = await env.DB.prepare(
            `SELECT * FROM generation_jobs WHERE id IN (${placeholders})`
          ).bind(...jobIds).all<GenerationJob>()

          if (jobs.results.length !== jobIds.length) {
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: false,
                error: 'One or more jobs not found'
              }) }],
              isError: true
            }
          }

          // Check if all completed or any failed
          const completed = jobs.results.filter(j => j.status === 'completed')
          const failed = jobs.results.filter(j => j.status === 'failed')
          const pending = jobs.results.filter(j => j.status === 'pending' || j.status === 'processing')

          // If any failed, return error
          if (failed.length > 0) {
            if (isSingle) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  success: false,
                  status: 'failed',
                  error: failed[0].error || 'Generation failed'
                }, null, 2) }],
                isError: true
              }
            }
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: false,
                error: `${failed.length} job(s) failed`,
                failed: failed.map(j => ({ job_id: j.id, error: j.error })),
                completed: completed.map(j => ({ job_id: j.id, image_url: j.image_url }))
              }, null, 2) }],
              isError: true
            }
          }

          // If all completed, return success
          if (pending.length === 0) {
            if (isSingle) {
              const job = completed[0]
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
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                count: completed.length,
                results: completed.map(j => ({
                  job_id: j.id,
                  image_url: j.image_url,
                  prompt: j.prompt,
                  model: j.model
                }))
              }, null, 2) }]
            }
          }

          // Wait before next poll (doesn't count against CPU time)
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
        }

        // Timeout
        const timeoutSeconds = Math.round(MAX_WAIT / 1000)
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: `Timeout: Image generation took longer than ${timeoutSeconds} seconds`
          }, null, 2) }],
          isError: true
        }
      }

      case 'generate_image_and_wait': {
        // First generate (handles count internally)
        const genResult = await callImageTool('generate_image', args, env)

        // Extract job_id(s) from generate result
        const genData = JSON.parse(genResult.content[0].text)

        // Then wait with appropriate parameters
        if (genData.count && genData.count > 1) {
          return await callImageTool('wait_for_completion', { job_ids: genData.job_ids }, env)
        } else {
          return await callImageTool('wait_for_completion', { job_id: genData.job_id }, env)
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    console.error(`Tool ${name} error:`, error)
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
