param([Parameter(Mandatory = $true)][string]$InstallDir)

$ErrorActionPreference = 'Stop'
try {
    # Scope by executable path: other applications' Node/Java processes stay alive.
    $runtime = [IO.Path]::GetFullPath((Join-Path $InstallDir 'resources\runtime')).TrimEnd('\') + '\'
    $children = Get-Process | Where-Object {
        $_.Path -and $_.Path.StartsWith($runtime, [StringComparison]::OrdinalIgnoreCase)
    }
    foreach ($child in $children) {
        if ($child.HasExited) { continue }
        Stop-Process -InputObject $child -Force
        if (-not $child.WaitForExit(10000)) {
            throw "Timed out waiting for runtime process $($child.Id)."
        }
    }
} catch {
    Write-Output $_.Exception.Message
    exit 1
}
