param(
  [string]$SupabaseUrl,
  [string]$CrmAppUrl = "http://127.0.0.1:5173",
  [string]$SystemActorUserId,
  [string]$N8nImage = "docker.n8n.io/n8nio/n8n:2.30.5",
  [int]$N8nPort = 5678
)

$ErrorActionPreference = "Stop"
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $workspaceRoot "deploy\.env.n8n.local"

function Assert-SafeEnvValue([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Contains("`r") -or $Value.Contains("`n")) {
    throw "$Name is missing or contains a newline."
  }
}

function New-RandomSecret([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

if (Test-Path -LiteralPath $envPath) {
  $required = @("N8N_IMAGE", "N8N_DB_PASSWORD", "N8N_ENCRYPTION_KEY", "N8N_INTERNAL_SECRET", "SUPABASE_URL", "CRM_APP_URL", "SYSTEM_ACTOR_USER_ID")
  $existing = @{}
  Get-Content -LiteralPath $envPath -Encoding utf8 | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $existing[$matches[1].Trim()] = $matches[2] }
  }
  $missing = $required | Where-Object { -not $existing.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($existing[$_]) }
  if ($missing) { throw "Existing n8n env is incomplete: $($missing -join ', ')" }
  Write-Output "Existing local n8n environment reused; encryption material was not changed."
  Write-Output $envPath
  exit 0
}

Assert-SafeEnvValue "SupabaseUrl" $SupabaseUrl
Assert-SafeEnvValue "CrmAppUrl" $CrmAppUrl
Assert-SafeEnvValue "SystemActorUserId" $SystemActorUserId
Assert-SafeEnvValue "N8nImage" $N8nImage
if ($SystemActorUserId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw "SystemActorUserId must be a UUID." }
if ($N8nPort -lt 1 -or $N8nPort -gt 65535) { throw "N8nPort must be a valid TCP port." }

$lines = @(
  "N8N_IMAGE=$N8nImage",
  "N8N_PORT=$N8nPort",
  "N8N_DB_PASSWORD=$(New-RandomSecret 36)",
  "N8N_ENCRYPTION_KEY=$(New-RandomSecret 48)",
  "N8N_INTERNAL_SECRET=$(New-RandomSecret 48)",
  "SUPABASE_URL=$SupabaseUrl",
  "CRM_APP_URL=$CrmAppUrl",
  "SYSTEM_ACTOR_USER_ID=$SystemActorUserId",
  "AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
  "AI_PROVIDER=aliyun_bailian"
)

[System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Output "Created a Git-ignored local n8n environment without printing secrets."
Write-Output $envPath
