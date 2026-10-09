param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 65535)]
  [int]$StartPort,
  [ValidateRange(1, 65535)]
  [int]$EndPort = 8199
)

for ($port = $StartPort; $port -le $EndPort; $port++) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
    $listener.Start()
    $listener.Stop()
    Write-Output $port
    exit 0
  } catch {
    if ($listener) { $listener.Stop() }
  }
}

exit 1
