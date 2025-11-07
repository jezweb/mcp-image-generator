/**
 * Type definitions for MCP Image Generator v3
 * Stateless Workers architecture with D1, Queues, R2, and Workers AI
 */

// Environment bindings (from wrangler.jsonc)
export interface Env {
  AI: Ai
  R2_BUCKET: R2Bucket
  DB: D1Database
  IMAGE_QUEUE: Queue
  AUTH_TOKEN: string
}

// Database row types (matches D1 schema exactly)
export interface GenerationJob {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  prompt: string
  model: 'flux-schnell' | 'sdxl-lightning' | 'sdxl-base'
  image_url: string | null
  error: string | null
  created_at: number  // Unix timestamp (milliseconds)
  updated_at: number  // Unix timestamp (milliseconds)
}

export interface Generation {
  id: string
  job_id: string
  image_url: string
  prompt: string
  model: 'flux-schnell' | 'sdxl-lightning' | 'sdxl-base'
  created_at: number  // Unix timestamp (milliseconds)
}

// Queue message type for async image generation
export interface ImageGenerationMessage {
  jobId: string
  prompt: string
  model: 'flux-schnell' | 'sdxl-lightning' | 'sdxl-base'
}

// Tool input types (for Zod schema validation)
export interface GenerateImageInput {
  prompt: string
  model?: 'flux-schnell' | 'sdxl-lightning' | 'sdxl-base'
}

export interface GetJobStatusInput {
  job_id: string
}

export interface ListGenerationsInput {
  limit?: number
  offset?: number
}

export interface ListJobsInput {
  status?: 'all' | 'pending' | 'processing' | 'completed' | 'failed'
  limit?: number
  offset?: number
}

// Tool output types (for type-safe responses)
export interface GenerateImageOutput {
  success: boolean
  job_id: string
  status: 'pending'
  message: string
  prompt: string
  model: string
  estimated_time_seconds: number
}

export interface JobStatusOutput {
  success: boolean
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  image_url?: string
  error?: string
  prompt: string
  model: string
  created_at: number
  updated_at: number
}

export interface ListGenerationsOutput {
  success: boolean
  total_count: number
  returned_count: number
  has_more: boolean
  limit: number
  offset: number
  generations: Array<{
    id: string
    job_id: string
    image_url: string
    prompt: string
    model: string
    created_at: number
  }>
}

export interface ListJobsOutput {
  success: boolean
  filter: string
  total_count: number
  returned_count: number
  has_more: boolean
  limit: number
  offset: number
  jobs: Array<{
    id: string
    status: string
    prompt: string
    model: string
    image_url: string | null
    error: string | null
    created_at: number
    updated_at: number
  }>
}
