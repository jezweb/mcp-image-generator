# Setup Guide - MCP Image Generator

Complete step-by-step guide to deploy your own MCP Image Generator server on Cloudflare.

## Prerequisites

- [Cloudflare Account](https://dash.cloudflare.com/sign-up) (free tier works!)
- [Node.js](https://nodejs.org/) v18 or higher
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed

## Quick Deploy (5 minutes)

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/mcp-image-generator.git
cd mcp-image-generator
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Create Cloudflare Resources

#### Create D1 Database

```bash
npx wrangler d1 create mcp-image-generator-db
```

Copy the `database_id` from the output and update `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "mcp-image-generator-db",
    "database_id": "YOUR_DATABASE_ID_HERE"  // <-- Paste here
  }
]
```

#### Run Database Migrations

```bash
npx wrangler d1 migrations apply mcp-image-generator-db --remote
```

#### Create R2 Bucket

```bash
npx wrangler r2 bucket create mcp-image-generator-bucket
```

#### Create Queue

```bash
npx wrangler queues create image-generation-queue
npx wrangler queues create image-generation-dlq
```

### 4. Set Auth Token Secret

Generate a secure random token:

```bash
openssl rand -base64 32
```

Set it as a secret:

```bash
npx wrangler secret put AUTH_TOKEN
# Paste the generated token when prompted
```

For local development, also create `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars and paste your token
```

### 5. Deploy

```bash
npm run deploy
```

Your server will be live at: `https://mcp-image-generator.YOUR_ACCOUNT.workers.dev`

## Local Development

```bash
# Start local dev server
npm run dev

# In another terminal, test with curl
curl http://localhost:8787/health
```

## Verify Deployment

Test your deployment:

```bash
# Check health endpoint
curl https://mcp-image-generator.YOUR_ACCOUNT.workers.dev/health

# Test tools list (use your AUTH_TOKEN)
curl -X POST https://mcp-image-generator.YOUR_ACCOUNT.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Connect MCP Clients

### Claude Desktop

Add to `~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "image-generator": {
      "url": "https://mcp-image-generator.YOUR_ACCOUNT.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_AUTH_TOKEN"
      }
    }
  }
}
```

### MCP Inspector (Testing)

```bash
npx @modelcontextprotocol/inspector \
  https://mcp-image-generator.YOUR_ACCOUNT.workers.dev/sse \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

## Custom Domain (Optional)

1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your worker → Settings → Triggers
3. Add Custom Domain
4. Configure DNS (automatic with Cloudflare)

## Cost Estimates

Cloudflare Free Tier includes:
- ✅ 100,000 Worker requests/day
- ✅ 10 GB R2 storage
- ✅ 1,000 D1 rows written/day
- ✅ 5 million D1 rows read/day
- ✅ 1,000 Queues operations/day

**Workers AI pricing**:
- FLUX Schnell: ~$0.003 per image
- SDXL Lightning: ~$0.007 per image
- SDXL Base: ~$0.015 per image

Generating 100 images/month with FLUX: **~$0.30/month**

## Troubleshooting

### "Unauthorized" errors
- Verify AUTH_TOKEN secret is set: `npx wrangler secret list`
- Check Authorization header format: `Bearer YOUR_TOKEN`

### "Database not found"
- Run migrations: `npx wrangler d1 migrations apply mcp-image-generator-db --remote`
- Verify database_id in wrangler.jsonc matches created database

### Images not generating
- Check queue consumer is deployed: `npx wrangler queues list`
- View logs: `npx wrangler tail`
- Verify Workers AI is enabled in your account

### "Bucket not found"
- Create bucket: `npx wrangler r2 bucket create mcp-image-generator-bucket`
- Verify bucket_name in wrangler.jsonc matches

## Monitoring

View real-time logs:

```bash
npx wrangler tail
```

Check queue status:

```bash
npx wrangler queues list
```

View D1 data:

```bash
npx wrangler d1 execute mcp-image-generator-db --command "SELECT * FROM generation_jobs LIMIT 10"
```

## Updating

Pull latest changes and redeploy:

```bash
git pull
npm install
npm run deploy
```

## Need Help?

- 📖 [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- 💬 [GitHub Issues](https://github.com/YOUR_USERNAME/mcp-image-generator/issues)
- 🌐 [MCP Documentation](https://modelcontextprotocol.io/)

## Next Steps

1. Try generating your first image via MCP Inspector
2. Connect Claude Desktop to use with AI assistant
3. Check the landing page at your worker URL for full API docs
4. Customize the code to add more models or features

Happy generating! 🎨
