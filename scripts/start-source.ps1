param([switch]$Diagnostico)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'build\launcher'
$launcher = Join-Path $output 'DigifortMonitor.exe'
try {
    $buildLock = [Threading.Mutex]::new($false, 'Local\DigifortMonitor.SourceBuild')
    $locked = $false
    try {
        try { $locked = $buildLock.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $locked = $true }
        if (!$locked) { throw 'A compilacao do inicializador esta ocupada. Tente novamente.' }
        $file = Get-Item -LiteralPath $launcher -ErrorAction SilentlyContinue
        $sources = Get-Item -LiteralPath (Join-Path $root 'installer\Launcher.cs'), (Join-Path $root 'installer\Artwork.cs'), (Join-Path $PSScriptRoot 'build-launcher.ps1')
        if (!$file -or ($sources | Where-Object { $_.LastWriteTimeUtc -gt $file.LastWriteTimeUtc })) {
            & (Join-Path $PSScriptRoot 'build-launcher.ps1') -OutputDirectory $output
        }
    } finally {
        if ($locked) { $buildLock.ReleaseMutex() }
        $buildLock.Dispose()
    }
    $arguments = @('--source', ('"{0}"' -f $root))
    if ($Diagnostico) {
        $process = Start-Process -FilePath $launcher -ArgumentList ($arguments + '--diagnostico') -Wait -PassThru
        exit $process.ExitCode
    }
    Start-Process -FilePath $launcher -ArgumentList $arguments
} catch {
    if ($Diagnostico) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Digifort Monitor', 'OK', 'Error')
    exit 1
}
