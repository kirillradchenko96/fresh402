param(
    [switch]$CopyToClipboard,
    [switch]$Smoke,
    [string]$Url
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$tokenFile = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Fresh402\staging\access-token.dpapi'
if (-not (Test-Path -LiteralPath $tokenFile)) { throw 'Owner staging access store is missing.' }
$encrypted = [IO.File]::ReadAllBytes($tokenFile)
$plain = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
    $token = [Text.Encoding]::UTF8.GetString($plain)
    if ($CopyToClipboard) {
        Set-Clipboard -Value $token
        Write-Output 'Staging access token copied to the owner clipboard; it was not printed.'
    } elseif ($Smoke) {
        if ($Url -notmatch '^https://fresh402-staging\.[a-z0-9-]+\.workers\.dev/?$') { throw 'Only the isolated staging workers.dev URL is accepted.' }
        $previous = $env:FRESH402_STAGING_TOKEN
        try {
            $env:FRESH402_STAGING_TOKEN = $token
            & node (Join-Path $PSScriptRoot 'staging-smoke.mjs') $Url
            if ($LASTEXITCODE -ne 0) { throw 'Staging smoke failed; stop cloud work.' }
        } finally { $env:FRESH402_STAGING_TOKEN = $previous }
    } else { throw 'Select -CopyToClipboard or -Smoke -Url HTTPS_STAGING_URL. The token is never printed.' }
} finally {
    [Array]::Clear($plain, 0, $plain.Length)
    $token = $null
}
