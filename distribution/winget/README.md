# WinGet distribution

Package identifier: `cccadet.omni-sql`. Manifests target the published `v0.5.4`
Windows x64 NSIS installer, installed for the current user.
The existing NSIS installer provisions WebView2 when the runtime is missing.

Keeping these manifests in this repository does not publish the package to
WinGet. Submission and approval happen separately in `microsoft/winget-pkgs`.
Do not advertise `winget install` until the package is available in its source.

The downloaded installer SHA256 was verified against the release's `SHA256SUMS`.
The YAML files use Microsoft's 1.10 manifest schemas, supported by the Windows
runner's WinGet 1.11 client; no fields require a newer schema. The
`WinGet package validation` workflow checks the actual Windows client, silent
installation, Add/Remove Programs detection, upgrade from `v0.5.3` and silent
uninstallation through WinGet. Windows preflight also checks the newly built
installer and silent removal through WinGet. A successful run against the
published release is required before submission. This
checks packaging, not application UI or database query behavior.

The disposable Windows runner trusts the HTTPS GitHub release hosts for this
test. Local manifests otherwise retain Internet-zone Mark of the Web, which can
block unattended ShellExecute with a security dialog before NSIS starts. Packages
from WinGet's trusted community source receive a trusted-zone mark after their
hash is verified. The test keeps SHA256 verification and antivirus scanning.

`AppsAndFeaturesEntries.Publisher` is `omnisql`, the existing Tauri default derived
from `dev.omnisql`. The public publisher metadata uses the author's name from the
MIT license. Do not change the installed publisher without checking upgrades.

## Submit

1. Run the Windows validation workflow and merge the approved Omni SQL PR into
   `main` before submitting to Microsoft's repository.
2. Copy `manifests/c/cccadet/omni-sql/0.5.4/` into a fork of
   [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).
3. Open a PR titled `New package: cccadet.omni-sql version 0.5.4`.
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
