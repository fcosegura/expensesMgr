import { execSync } from 'node:child_process'

function hasAnyToken() {
  return Boolean(process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN)
}

const binding = process.env.D1_BINDING || 'DB'

if (!hasAnyToken()) {
  console.log(`[cf-init] Skipping D1 migrations: missing CF_API_TOKEN/CLOUDFLARE_API_TOKEN`)
  process.exit(0)
}

console.log(`[cf-init] Applying D1 migrations (binding: ${binding})...`)

// This uses Wrangler's D1 migrations tracking table so it is safe to re-run in CI/CD.
execSync(`npx wrangler d1 migrations apply ${binding} --remote`, {
  stdio: 'inherit',
  env: process.env,
})

