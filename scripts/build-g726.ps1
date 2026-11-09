$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$imageName = 'digifort-g726-wasm-builder:local'

docker build --tag $imageName --file (Join-Path $projectRoot 'wasm/g726/Dockerfile') (Join-Path $projectRoot 'wasm/g726')
if ($LASTEXITCODE -ne 0) {
  throw 'Falha ao preparar o compilador Docker para G.726.'
}

$outputDir = Join-Path $projectRoot 'public/wasm'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
docker run --rm --volume "${outputDir}:/out" $imageName
if ($LASTEXITCODE -ne 0) {
  throw 'Falha ao compilar o decoder G.726. Verifique se o Docker Desktop está ativo.'
}

# wasm-pack marks the output as ignored by default; keep the reusable browser artifacts trackable.
$generatedIgnore = Join-Path $outputDir '.gitignore'
if (Test-Path -LiteralPath $generatedIgnore) {
  Remove-Item -LiteralPath $generatedIgnore
}
