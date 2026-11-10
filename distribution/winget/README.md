# WinGet distribution

Package identifier: `cccadet.omni-sql`. The manifests in
`manifests/c/cccadet/omni-sql/0.5.4/` target the `v0.5.4` Windows x64 NSIS
installer (current-user install; the installer provisions WebView2 if missing).
They are older than the current release and must be regenerated before any new
submission.

Keeping manifests here does not publish the package: submission and approval
happen in [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). Do
not advertise `winget install` until the package is available there.

## Validation

The `WinGet package validation` workflow uses the real Windows client to check
silent install, Add/Remove Programs detection, upgrade from the previous version
and silent uninstall. Windows preflight also installs and removes the newly built
installer through WinGet. This validates packaging only, not app behavior. The
runner trusts the GitHub release hosts so Mark of the Web does not block the
unattended installer; SHA256 verification and antivirus scanning stay on.

`AppsAndFeaturesEntries.Publisher` is `omnisql`, the Tauri default derived from
`dev.omnisql`. Do not change it without checking upgrades.

## Submitting a version

1. Generate manifests for the published release with
   [WinGetCreate](https://github.com/microsoft/winget-create), pointing at the
   versioned installer URL (never a mutable `latest` URL), and verify the SHA256
   against the release's `SHA256SUMS`.
2. Run the validation workflow and merge the manifests here.
3. Copy the version folder into a fork of `microsoft/winget-pkgs` and open a PR
   (`New package: cccadet.omni-sql version X.Y.Z` for the first submission).
4. After Microsoft merges it, check
   `winget show --id cccadet.omni-sql --exact --source winget`.

References: [manifest authoring](https://learn.microsoft.com/windows/package-manager/package/manifest),
[repository submission](https://learn.microsoft.com/windows/package-manager/package/repository).
