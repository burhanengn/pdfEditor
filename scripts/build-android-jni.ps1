$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$CoreManifest = Join-Path $RootDir "core\Cargo.toml"
$JniLibsDir = Join-Path $RootDir "android\app\src\main\jniLibs"
$ExistingPdfiumDir = Join-Path $RootDir "mobile\android\app\src\main\jniLibs"

$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$AndroidSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$NdkBin = Join-Path $AndroidSdk "ndk\28.0.12674087\toolchains\llvm\prebuilt\windows-x86_64\bin"
if (-not (Test-Path $NdkBin)) {
    $NdkBin = Join-Path $AndroidSdk "ndk\25.1.8937393\toolchains\llvm\prebuilt\windows-x86_64\bin"
}
if (-not (Test-Path $NdkBin)) {
    throw "Android NDK LLVM bin directory not found under $AndroidSdk\ndk"
}

$Targets = @(
    @{ Triple = "aarch64-linux-android"; Abi = "arm64-v8a"; Clang = "aarch64-linux-android26-clang.cmd"; EnvKey = "AARCH64_LINUX_ANDROID" },
    @{ Triple = "armv7-linux-androideabi"; Abi = "armeabi-v7a"; Clang = "armv7a-linux-androideabi26-clang.cmd"; EnvKey = "ARMV7_LINUX_ANDROIDEABI" },
    @{ Triple = "x86_64-linux-android"; Abi = "x86_64"; Clang = "x86_64-linux-android26-clang.cmd"; EnvKey = "X86_64_LINUX_ANDROID" }
)

$ArExe = Join-Path $NdkBin "llvm-ar.exe"

foreach ($t in $Targets) {
    $LinkerCmd = Join-Path $NdkBin $t.Clang
    $Triple = $t.Triple
    $Abi = $t.Abi
    $EnvKey = $t.EnvKey
    $CcUnder = $Triple.Replace("-", "_")

    Write-Host "Building libgp_jni.so for $Triple ($Abi)..." -ForegroundColor Cyan
    Set-Item -Path "Env:CARGO_TARGET_${EnvKey}_LINKER" -Value $LinkerCmd
    Set-Item -Path "Env:CC_$CcUnder" -Value $LinkerCmd
    Set-Item -Path "Env:AR_$CcUnder" -Value $ArExe

    # Ensure 16KB page-size alignment on Android 15+ devices
    Set-Item -Path "Env:CARGO_TARGET_${EnvKey}_RUSTFLAGS" -Value "-C link-arg=-Wl,-z,max-page-size=16384"

    cargo build --release --manifest-path $CoreManifest -p gp-jni --target $Triple
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build failed for $Triple"
    }

    $OutAbiDir = Join-Path $JniLibsDir $Abi
    New-Item -ItemType Directory -Force -Path $OutAbiDir | Out-Null

    $BuiltSo = Join-Path $RootDir "core\target\$Triple\release\libgp_jni.so"
    Copy-Item -Force $BuiltSo (Join-Path $OutAbiDir "libgp_jni.so")

    $PdfiumSrc = Join-Path $ExistingPdfiumDir "$Abi\libpdfium.so"
    if (Test-Path $PdfiumSrc) {
        Copy-Item -Force $PdfiumSrc (Join-Path $OutAbiDir "libpdfium.so")
    } else {
        Write-Warning "Missing libpdfium.so at $PdfiumSrc"
    }
}

Write-Host "All Android JNI libraries ready in $JniLibsDir" -ForegroundColor Green
