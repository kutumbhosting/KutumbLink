param(
  [int]$Port = 8080
)

# The server can take a little while to finish starting, especially on first run.
# Wait for its lightweight health endpoint before opening the public app page.
$healthUrl = "http://127.0.0.1:$Port/ping"
$appUrl = "http://localhost:$Port/"
$deadline = [DateTime]::UtcNow.AddSeconds(180)

while ([DateTime]::UtcNow -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 3 -UseBasicParsing
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
      try {
        Start-Process -FilePath $appUrl
      } catch {
        # Use the Windows URL handler if PowerShell cannot resolve the default browser.
        Start-Process -FilePath "$env:WINDIR\System32\rundll32.exe" -ArgumentList "url.dll,FileProtocolHandler `"$appUrl`""
      }
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}

# Leave a useful clue if startup took longer than expected; app.cmd remains open
# with the server output, so users can still open this address manually.
$logPath = Join-Path $env:TEMP 'KutumbLink-browser-launch.log'
"Could not reach $healthUrl before the 180 second timeout. Open $appUrl manually after the server is ready." |
  Set-Content -Path $logPath -Encoding UTF8
exit 1
