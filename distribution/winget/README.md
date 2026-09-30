# WinGet distribution

Package identifier: `cccadet.omni-sql`. Initial submission targets the published
`v0.5.2` Windows x64 NSIS installer, installed for the current user.

Keeping these manifests in this repository does not publish the package to
WinGet. Submission and approval happen separately in `microsoft/winget-pkgs`.
Do not advertise `winget install` until the package is available in its source.

The downloaded installer SHA256 was verified against the release's `SHA256SUMS`.
The YAML files are validated against Microsoft's manifest schemas. The
`WinGet package validation` workflow checks the actual Windows client, silent
installation, Add/Remove Programs detection, upgrade from `v0.5.1` and silent
uninstallation. Its first successful run is required before submission. This
checks packaging, not application UI or database query behavior.

`AppsAndFeaturesEntries.Publisher` is `omnisql`, the existing Tauri default derived
from `dev.omnisql`. The public publisher metadata uses the author's name from the
MIT license. Do not change the installed publisher without checking upgrades.

## Submit

1. Run the Windows validation workflow and merge the approved Omni SQL PR into
   `main` before submitting to Microsoft's repository.
2. Copy `manifests/c/cccadet/omni-sql/0.5.2/` into a fork of
   [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).
3. Open a PR titled `New package: cccadet.omni-sql version 0.5.2`.
4. Address Microsoft's validation/review findings; after merge, verify
   `winget show --id cccadet.omni-sql --exact --source winget`.

Submitting a package does not require a paid Microsoft account or Store listing.
Microsoft review and source indexing determine when it becomes available.

## Subsequent releases

After the GitHub release is published, use
[WinGetCreate](https://github.com/microsoft/winget-create) to update the existing
package with the new versioned installer URL and submit the resulting manifests.
Verify the downloaded SHA256, detection metadata and upgrade from the previous
version each time. Never point an installer manifest at a mutable `latest` URL.

References: [manifest authoring](https://learn.microsoft.com/windows/package-manager/package/manifest),
[repository submission](https://learn.microsoft.com/windows/package-manager/package/repository).
