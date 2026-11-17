param(
  [string[]]$Abis = @("arm64-v8a", "armeabi-v7a", "x86_64"),
  [switch]$DebugBuild
)

$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\.cargo\bin;" + $env:PATH
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$CoreManifest = Join-Path $RepoRoot "core\Cargo.toml"
$SdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$NdkRoot = Get-ChildItem (Join-Path $SdkRoot "ndk") | Sort-Object Name -Descending | Select-Object -First 1
if (-not $NdkRoot) {
  throw "Android NDK not found under $SdkRoot\ndk"
}
$LlvmBin = Join-Path $NdkRoot.FullName "toolchains\llvm\prebuilt\windows-x86_64\bin"

$TargetSpecs = @{
  "arm64-v8a" = @{
    Triple = "aarch64-linux-android"
    EnvKey = "CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER"
    Linker = Join-Path $LlvmBin "aarch64-linux-android26-clang.cmd"
    OutDir = "arm64-v8a"
  }
  "armeabi-v7a" = @{
    Triple = "armv7-linux-androideabi"
    EnvKey = "CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER"
    Linker = Join-Path $LlvmBin "armv7a-linux-androideabi26-clang.cmd"
    OutDir = "armeabi-v7a"
  }
  "x86_64" = @{
    Triple = "x86_64-linux-android"
    EnvKey = "CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER"
    Linker = Join-Path $LlvmBin "x86_64-linux-android26-clang.cmd"
    OutDir = "x86_64"
  }
}

$profileDir = if ($DebugBuild) { "debug" } else { "release" }

foreach ($abi in $Abis) {
  $spec = $TargetSpecs[$abi]
  if (-not $spec) { throw "Unsupported ABI: $abi" }
  if (-not (Test-Path $spec.Linker)) {
    throw "Missing NDK clang linker: $($spec.Linker)"
  }
  Set-Item "Env:$($spec.EnvKey)" $spec.Linker
  $ccEnv = "CC_" + ($spec.Triple -replace "-", "_")
  $arEnv = "AR_" + ($spec.Triple -replace "-", "_")
  Set-Item "Env:$ccEnv" $spec.Linker
  Set-Item "Env:$arEnv" (Join-Path $LlvmBin "llvm-ar.exe")
  # Android 15+ 16 KB ELF page size compatibility (04 §4.7)
  $env:RUSTFLAGS = "-C link-arg=-Wl,-z,max-page-size=16384"

  Write-Host "Building gp-frb for Android $abi ($($spec.Triple)) [$profileDir]..."
  $cargoArgs = @("build", "--manifest-path", $CoreManifest, "-p", "gp-frb", "--target", $spec.Triple)
  if (-not $DebugBuild) {
    $cargoArgs += "--release"
  }
  & cargo @cargoArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Cargo build failed for $($spec.Triple)"
  }

  $srcSo = Join-Path $RepoRoot "core\target\$($spec.Triple)\$profileDir\libgp_frb.so"
  $dstDir = Join-Path $RepoRoot "mobile\android\app\src\main\jniLibs\$($spec.OutDir)"
  New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
  Copy-Item $srcSo (Join-Path $dstDir "libgp_frb.so") -Force
  Write-Host "Installed $(Join-Path $dstDir 'libgp_frb.so')"
}
