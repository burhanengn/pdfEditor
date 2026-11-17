param(
  [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ManifestPath = Join-Path $PSScriptRoot "..\third_party\pdfium_7881_checksums.json"
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$CacheRoot = Join-Path $RepoRoot ".pdfium-cache\android"
$JniRoot = Join-Path $RepoRoot "mobile\android\app\src\main\jniLibs"

foreach ($abi in @("arm64-v8a", "armeabi-v7a", "x86_64")) {
  $spec = $Manifest.android.$abi
  $destDir = Join-Path $JniRoot $abi
  $destFile = Join-Path $destDir "libpdfium.so"

  if (-not $VerifyOnly) {
    $cacheDir = Join-Path $CacheRoot $abi
    New-Item -ItemType Directory -Force -Path $cacheDir, $destDir | Out-Null
    $tgz = Join-Path $CacheRoot "$abi.tgz"
    if (-not (Test-Path $tgz)) {
      Write-Host "Downloading PDFium $abi ($($Manifest.release))..."
      Invoke-WebRequest -Uri $spec.url -OutFile $tgz
    }
    tar -xzf $tgz -C $cacheDir
    Copy-Item (Join-Path $cacheDir "lib\libpdfium.so") $destFile -Force
  }

  if (-not (Test-Path $destFile)) {
    throw "Missing PDFium library: $destFile"
  }
  $actualHash = (Get-FileHash $destFile -Algorithm SHA256).Hash.ToUpperInvariant()
  $expectedHash = $spec.sha256.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "SHA256 mismatch for $abi ($actualHash != $expectedHash)"
  }
  Write-Host "OK PDFium $abi SHA256 verified ($actualHash)"
}
