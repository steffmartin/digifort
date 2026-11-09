param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$ChromePath,
  [Parameter(Mandatory = $true)][string]$ProfilePath
)

$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ([DateTime]::UtcNow -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
      $arguments = @(
        '--disable-web-security',
        "--user-data-dir=`"$ProfilePath`"",
        '--new-window',
        "`"$Url`""
      ) -join ' '
      Start-Process -FilePath $ChromePath -ArgumentList $arguments
      exit 0
    }
  } catch {
    # Aguardando o servidor local ficar pronto.
  }
  Start-Sleep -Milliseconds 500
}
