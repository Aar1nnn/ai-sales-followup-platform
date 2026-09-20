$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $PSScriptRoo
$playwrightConfig = Get-Content -LiteralPath (Join-Path $workspaceRoot "playwright.config.js") -Raw -Encoding utf8
$localSupabaseUrl = [regex]::Match($playwrightConfig, 'VITE_SUPABASE_URL:\s*"([^"]+)"').Groups[1].Value
$localPublishableKey = [regex]::Match($playwrightConfig, 'VITE_SUPABASE_PUBLISHABLE_KEY:\s*"([^"]+)"').Groups[1].Value

if (-not $localSupabaseUrl -or -not $localPublishableKey) {
  throw "Local Supabase browser configuration is missing."
}

$env:VITE_SUPABASE_URL = $localSupabaseUrl
$env:VITE_SUPABASE_PUBLISHABLE_KEY = $localPublishableKey
Set-Location -LiteralPath $workspaceRoo
& npm.cmd run dev -- --host 127.0.0.1 --port 4173
