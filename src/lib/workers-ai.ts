interface Env {
  AI: Ai
}

interface GenerateImageParams {
  prompt: string
  model?: 'flux-schnell' | 'sdxl-lightning' | 'sdxl-base'
}

interface GenerateImageResult {
  imageData: Uint8Array
  model: string
  generationTimeMs: number
}

/**
 * Generate an image using Cloudflare Workers AI
 *
 * Supported models:
 * - flux-schnell: @cf/black-forest-labs/flux-1-schnell (fastest, good quality)
 * - sdxl-lightning: @cf/bytedance/stable-diffusion-xl-lightning (fast, high quality)
 * - sdxl-base: @cf/stabilityai/stable-diffusion-xl-base-1.0 (slower, best quality)
 */
export async function generateImage(
  env: Env,
  params: GenerateImageParams
): Promise<GenerateImageResult> {
  const startTime = Date.now()

  // Map friendly model names to Workers AI model IDs
  const modelMap = {
    'flux-schnell': '@cf/black-forest-labs/flux-1-schnell',
    'sdxl-lightning': '@cf/bytedance/stable-diffusion-xl-lightning',
    'sdxl-base': '@cf/stabilityai/stable-diffusion-xl-base-1.0'
  }

  const modelName = params.model || 'flux-schnell'
  const modelId = modelMap[modelName]

  console.log(`Generating image with model: ${modelId}`)
  console.log(`Prompt: ${params.prompt}`)

  try {
    // Call Workers AI to generate the image
    const response = await env.AI.run(modelId, {
      prompt: params.prompt
    })

    const generationTime = Date.now() - startTime

    // Workers AI can return different response types
    let imageData: Uint8Array

    if (response instanceof Response) {
      // Response object - extract arrayBuffer
      const arrayBuffer = await response.arrayBuffer()
      imageData = new Uint8Array(arrayBuffer)
    } else if (response instanceof ReadableStream) {
      // ReadableStream - convert to Uint8Array using Response wrapper
      const bytes = await (new Response(response)).bytes()
      imageData = new Uint8Array(bytes)
    } else if (response instanceof Uint8Array) {
      // Already a Uint8Array
      imageData = response
    } else if (typeof response === 'object' && response !== null) {
      // Plain object - Workers AI returns { image: "base64-string" } for FLUX/SDXL models
      const obj = response as any

      if (obj.image && typeof obj.image === 'string') {
        // Base64-decode the image string to binary
        console.log('Decoding Base64 image string...')
        const binaryString = atob(obj.image)
        imageData = Uint8Array.from(binaryString, (m) => m.codePointAt(0)!)
      } else if (obj.image && obj.image instanceof Uint8Array) {
        // Already a Uint8Array
        imageData = obj.image
      } else if (obj.image && typeof obj.image === 'object') {
        // Image might be an ArrayBuffer or array-like object
        imageData = new Uint8Array(obj.image)
      } else if (ArrayBuffer.isView(obj)) {
        // Object is a typed array view
        imageData = new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength)
      } else {
        // Last resort: try to convert the response itself to a stream
        console.log('Trying to convert object response to stream...')
        const bytes = await (new Response(obj as any)).bytes()
        imageData = new Uint8Array(bytes)
      }
    } else {
      throw new Error(`Unexpected response type from Workers AI: ${typeof response}`)
    }

    console.log(`Image generated successfully: ${imageData.length} bytes in ${generationTime}ms`)

    return {
      imageData,
      model: modelName,
      generationTimeMs: generationTime
    }
  } catch (error) {
    console.error('Workers AI generation error:', error)
    throw new Error(`Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
