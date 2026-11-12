param([string]$IsccPath)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$nodeVersion = '24.22.2'
$nodeHash = 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
$archiveName = "node-v$nodeVersion-win-x64.zip"

if (!$IsccPath) {
    $IsccPath = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
    if (!$IsccPath) {
        $IsccPath = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | ForEach-Object {
            Join-Path $_ 'Inno Setup 7\ISCC.exe'
        } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
}
if (!$IsccPath -or !(Test-Path -LiteralPath $IsccPath -PathType Leaf)) { throw 'Inno Setup 7 ausente. Informe -IsccPath.' }

$build = New-Item -ItemType Directory -Force -Path (Join-Path $root 'build\installer')
$dist = New-Item -ItemType Directory -Force -Path (Join-Path $root 'dist')
$archive = Join-Path $build.FullName $archiveName
if (!(Test-Path -LiteralPath $archive -PathType Leaf) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $nodeHash) {
    $download = $archive + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/$archiveName" -OutFile $download
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $nodeHash) { throw 'SHA-256 do Node.js divergente.' }
        Move-Item -LiteralPath $download -Destination $archive -Force
    } finally {
        if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download }
    }
}

# Each build gets an independent staging directory and copies only release inputs.
$stage = New-Item -ItemType Directory -Path (Join-Path $build.FullName ('stage-' + [Guid]::NewGuid().ToString('N')))
$runtime = New-Item -ItemType Directory -Path (Join-Path $stage.FullName 'runtime')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($file in 'node.exe', 'LICENSE') {
        $entry = $zip.GetEntry("node-v$nodeVersion-win-x64/$file")
        if (!$entry) { throw "Arquivo ausente no runtime: $file" }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $runtime.FullName $file))
    }
} finally {
    $zip.Dispose()
}
& (Join-Path $PSScriptRoot 'build-launcher.ps1') -OutputDirectory $stage.FullName
Copy-Item -LiteralPath (Join-Path $root 'server.mjs'), (Join-Path $root 'package.json'), (Join-Path $root 'config\example.config') -Destination $stage.FullName
Copy-Item -LiteralPath (Join-Path $root 'public') -Recurse -Destination $stage.FullName

$script = Join-Path $root 'installer\digifort.iss'
& $IsccPath --no-signing --no-ide-signtools "/DStageDir=$($stage.FullName)" "/DOutputPath=$($dist.FullName)" "/DProductVersion=$version" $script
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o instalador.' }

$name = "Digifort-Monitor-Setup-$version.exe"
$installer = Join-Path $dist.FullName $name
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$checksums = Join-Path $dist.FullName 'SHA256SUMS.txt'
[IO.File]::WriteAllText($checksums, "$hash  $name`n", [Text.UTF8Encoding]::new($false))
Write-Output $installer, $checksums
