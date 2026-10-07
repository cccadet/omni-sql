$ErrorActionPreference = 'Stop'
$directory = Join-Path ([IO.Path]::GetTempPath()) ('omni-runtime-test-' + [guid]::NewGuid())
$processes = @()
try {
    foreach ($relative in @('resources\runtime\node\node.exe', 'resources\runtime\jre\bin\java.exe', 'resources\runtime-other\node.exe')) {
        $executable = Join-Path $directory $relative
        New-Item -ItemType Directory -Force -Path (Split-Path $executable) | Out-Null
        Copy-Item "$env:SystemRoot\System32\ping.exe" $executable
        $processes += Start-Process $executable -ArgumentList '-t', '127.0.0.1' -WindowStyle Hidden -PassThru
    }
    Start-Sleep -Milliseconds 500
    foreach ($child in $processes) {
        if ($child.HasExited) { throw 'Test runtime failed to start.' }
    }
    & "$PSScriptRoot\..\apps\desktop\src-tauri\stop-runtime.ps1" -InstallDir $directory
    if (-not $processes[0].WaitForExit(1000) -or -not $processes[1].WaitForExit(1000)) {
        throw 'Bundled runtimes survived cleanup.'
    }
    if ($processes[2].HasExited) { throw 'Cleanup stopped an unrelated runtime.' }
    Copy-Item "$env:SystemRoot\System32\ping.exe" (Join-Path $directory 'resources\runtime\node\node.exe') -Force
    & "$PSScriptRoot\..\apps\desktop\src-tauri\stop-runtime.ps1" -InstallDir $directory
    Write-Output 'PASS: orphan Node/Java stopped, executable replaceable, unrelated process preserved, repeat cleanup succeeds.'
} finally {
    foreach ($child in $processes) {
        if (-not $child.HasExited) { Stop-Process -InputObject $child -Force; $child.WaitForExit() }
        $child.Dispose()
    }
    Remove-Item $directory -Recurse -Force
}
