/**
 * Queue Consumer for Image Generation
 * Processes jobs from image-generation-queue asynchronously
 *
 * Flow:
 * 1. Receive message from queue (jobId, prompt, model)
 * 2. Update job status to "processing"
 * 3. Generate image using Workers AI
 * 4. Upload to R2 storage
 * 5. Update job status to "completed" with image_url
 * 6. Create record in generations table
 * 7. On error: Update job status to "failed" with error message
 */

import type { MessageBatch } from '@cloudflare/workers-types'
import type { Env, ImageGenerationMessage } from './types.js'
import { generateImage } from './lib/workers-ai.js'
import { uploadImage } from './lib/r2-storage.js'

export default {
  async queue(batch: MessageBatch<ImageGenerationMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    // Process each message in the batch
    for (const message of batch.messages) {
      const { jobId, prompt, model } = message.body

      console.log(`[Consumer] Processing job ${jobId}: "${prompt.substring(0, 50)}..." with ${model}`)

      try {
        // Step 1: Update status to 'processing'
        await env.DB.prepare(`
          UPDATE generation_jobs
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).bind('processing', Date.now(), jobId).run()

        console.log(`[Consumer] Job ${jobId} status updated to processing`)

        // Step 2: Generate image using Workers AI
        const result = await generateImage(env, {
          prompt,
          model: model || 'flux-schnell'
        })

        console.log(`[Consumer] Job ${jobId} image generated in ${result.generationTimeMs}ms`)

        // Step 3: Upload to R2
        const upload = await uploadImage(env, {
          imageData: result.imageData,
          prompt,
          model: result.model
        })

        console.log(`[Consumer] Job ${jobId} uploaded to R2: ${upload.downloadUrl}`)

        const now = Date.now()

        // Step 4: Update job as completed
        await env.DB.prepare(`
          UPDATE generation_jobs
          SET status = ?, image_url = ?, updated_at = ?
          WHERE id = ?
        `).bind('completed', upload.downloadUrl, now, jobId).run()

        // Step 5: Insert into generations archive
        await env.DB.prepare(`
          INSERT INTO generations (id, job_id, image_url, prompt, model, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), jobId, upload.downloadUrl, prompt, model, now).run()

        console.log(`[Consumer] Job ${jobId} completed successfully: ${upload.downloadUrl}`)

        // Acknowledge message (automatic if no error thrown)
        message.ack()

      } catch (error) {
        console.error(`[Consumer] Job ${jobId} failed:`, error)

        // Update job as failed with error message
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        try {
          await env.DB.prepare(`
            UPDATE generation_jobs
            SET status = ?, error = ?, updated_at = ?
            WHERE id = ?
          `).bind('failed', errorMessage, Date.now(), jobId).run()

          console.log(`[Consumer] Job ${jobId} marked as failed in database`)
        } catch (dbError) {
          console.error(`[Consumer] Failed to update job ${jobId} status:`, dbError)
        }

        // Retry the message (will go to DLQ after max_retries)
        message.retry()
      }
    }
  }
}
