interface Env {
  R2_BUCKET: R2Bucket
}

interface UploadImageParams {
  imageData: Uint8Array
  filename?: string
  prompt: string
  model: string
}

interface UploadImageResult {
  fileKey: string
  downloadUrl: string
  sizeBytes: number
}

/**
 * Upload an image to R2 storage and return public URL
 *
 * Features:
 * - Automatic filename generation from timestamp and prompt
 * - Filename sanitization (alphanumeric and hyphens only)
 * - Content-type detection (PNG format)
 * - Custom metadata storage (prompt, model, timestamp)
 * - Public URL generation using R2 public domain
 */
export async function uploadImage(
  env: Env,
  params: UploadImageParams
): Promise<UploadImageResult> {
  const timestamp = Date.now()

  // Sanitize prompt for filename: lowercase, alphanumeric + hyphens, max 50 chars
  const sanitizedPrompt = params.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .substring(0, 50)

  // Generate filename: timestamp-sanitized-prompt.png
  // Custom filename takes precedence if provided
  const filename = params.filename || `${timestamp}-${sanitizedPrompt}.png`

  console.log(`Uploading image to R2: ${filename}`)
  console.log(`Size: ${params.imageData.length} bytes`)

  try {
    // Upload to R2 with metadata
    await env.R2_BUCKET.put(filename, params.imageData, {
      httpMetadata: {
        contentType: 'image/png'
      },
      customMetadata: {
        prompt: params.prompt,
        model: params.model,
        generatedAt: new Date().toISOString()
      }
    })

    // Generate public download URL
    // Using R2 public bucket domain: https://pub-2f0bcc7992f04c6a8a44eb983f02d42a.r2.dev
    const downloadUrl = `https://pub-2f0bcc7992f04c6a8a44eb983f02d42a.r2.dev/${filename}`

    console.log(`Image uploaded successfully: ${downloadUrl}`)

    return {
      fileKey: filename,
      downloadUrl,
      sizeBytes: params.imageData.length
    }
  } catch (error) {
    console.error('R2 upload error:', error)
    throw new Error(`Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
