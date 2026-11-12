param([Parameter(Mandatory = $true)][string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = New-Item -ItemType Directory -Force -Path $OutputDirectory
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'Compilador do .NET Framework 4.x x64 indisponível.' }

if (-not ('DigifortArtwork' -as [type])) {
    Add-Type -Path (Join-Path $root 'installer\Artwork.cs') -ReferencedAssemblies System.Drawing
}
[DigifortArtwork]::Generate($output.FullName)
Copy-Item -LiteralPath (Join-Path $output.FullName 'camera.svg') -Destination (Join-Path $root 'public\favicon.svg') -Force
$icon = Join-Path $output.FullName 'camera.ico'
$launcher = Join-Path $output.FullName 'DigifortMonitor.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll "/win32icon:$icon" "/out:$launcher" (Join-Path $root 'installer\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o inicializador.' }
