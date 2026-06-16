# Fetches the full GraphQL schema from the HERO API via introspection
# and stores it as JSON + SDL under docs/api/.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# Load HERO_API_TOKEN from .env
$envFile = Join-Path $root ".env"
$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)\s*=\s*(.*)\s*$') {
        $envVars[$matches[1].Trim()] = $matches[2].Trim()
    }
}
$token = $envVars["HERO_API_TOKEN"]
if (-not $token) {
    throw "HERO_API_TOKEN not found in .env"
}

$query = [string](Get-Content (Join-Path $PSScriptRoot "introspection-query.graphql") -Raw)
$body = @{ query = $query } | ConvertTo-Json -Depth 1

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

try {
    $response = Invoke-RestMethod -Uri "https://login.hero-software.de/api/external/v7/graphql" -Method Post -Headers $headers -Body $body
} catch {
    $errResp = $_.Exception.Response
    if ($errResp) {
        $stream = $errResp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $errBody = $reader.ReadToEnd()
        Write-Output "HTTP $([int]$errResp.StatusCode) response body:"
        Write-Output $errBody
    }
    throw
}

$outDir = Join-Path $root "docs\api"
$outFile = Join-Path $outDir "schema.json"
$response | ConvertTo-Json -Depth 30 | Out-File -FilePath $outFile -Encoding utf8

Write-Output "Schema written to $outFile"
