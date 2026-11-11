# WinGet distribution

Package identifier: `cccadet.omni-sql`, published in the community repository
([microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs/tree/master/manifests/c/cccadet/omni-sql)).
The first versions were submitted by hand, the last of them 0.19.2
(microsoft/winget-pkgs#444746). Check what WinGet currently serves with:

```powershell
winget show --id cccadet.omni-sql --exact --source winget
```

Users install and upgrade with `winget install cccadet.omni-sql` and
`winget upgrade cccadet.omni-sql`. The package installs the Windows x64 NSIS
installer for the current user; the installer provisions WebView2 if missing.

## Automated updates

The `Submit WinGet update` job in `.github/workflows/release.yml` runs after
the GitHub Release is published. It uses [Komac](https://github.com/russellbanks/Komac)
(pinned version, archive SHA256 checked) to run:

```bash
komac update cccadet.omni-sql --version X.Y.Z \
  --urls https://github.com/cccadet/omni-sql/releases/download/vX.Y.Z/omni-sql_X.Y.Z_x64-setup.exe \
  --submit
```

Komac copies the metadata of the latest published manifest (identifier,
`ProductCode`, `AppsAndFeaturesEntries`, locale), downloads the versioned
installer to compute its SHA256, and opens the update PR from a fork owned by
the token's account. The job first checks that the installer is listed in the
release's `SHA256SUMS`, and uploads the generated manifests as the
`winget-manifests` artifact. It always uses the versioned release URL, never a
mutable `latest` URL. After Microsoft's validation pipeline and a moderator
approve the PR, the new version reaches `winget` clients, usually within a day.

Komac was chosen over WingetCreate because it runs on the Linux runner the
release job already uses (WingetCreate needs a Windows runner), ships as a
single checksummed binary and reuses the existing manifest the same way
`wingetcreate update` does.

### Required secret: `WINGET_TOKEN`

Add a repository secret named `WINGET_TOKEN` (Settings → Secrets and variables
→ Actions) containing a **classic** personal access token with only the
`public_repo` scope. Fine-grained tokens cannot open PRs in `winget-pkgs`.
The account that owns the token gets (or reuses) a fork of
`microsoft/winget-pkgs` and is shown as the PR author. Rotate the token before
it expires.

Without the secret the job logs `WinGet update skipped` as a notice and
succeeds, so releases never fail because of it. If the job fails after the
secret is set, the GitHub Release is already published; submit that version
manually (below).

## Manual bump

Use this to submit a version the workflow skipped or failed on, from Windows,
Linux or macOS:

```bash
winget install komac          # or download a release binary
komac token add               # paste a classic token with public_repo
komac update cccadet.omni-sql --version X.Y.Z \
  --urls https://github.com/cccadet/omni-sql/releases/download/vX.Y.Z/omni-sql_X.Y.Z_x64-setup.exe \
  --submit
```

`wingetcreate update cccadet.omni-sql --version X.Y.Z --urls <same URL> --submit`
works too. Before submitting, compare the installer hash with the release's
`SHA256SUMS`. If WinGet skipped intermediate versions, submitting only the
newest one is fine.

## Local manifests and validation

`manifests/c/cccadet/omni-sql/0.5.4/` is a frozen fixture, not the published
manifest; the published manifests live only in `microsoft/winget-pkgs`. The
`WinGet package validation` workflow uses it with the real Windows client to
check silent install, Add/Remove Programs detection, upgrade from 0.5.3 and
silent uninstall. Windows preflight separately installs and removes each newly
built installer through WinGet, and `winget-pkgs` validates every submitted
manifest, so the fixture is deliberately not regenerated for each release.
Update it only when installer metadata changes (see below). The runner trusts
the GitHub release hosts so Mark of the Web does not block the unattended
installer; SHA256 verification and antivirus scanning stay on.

`ProductCode` (`omni-sql`) and `AppsAndFeaturesEntries.Publisher` (`omnisql`,
the Tauri default derived from `dev.omnisql`) must match what the installer
writes to the registry. Komac carries them forward from the previous manifest,
so if either changes, update the fixture, run the validation workflow and edit
the generated manifest in the `winget-pkgs` PR.

References: [manifest authoring](https://learn.microsoft.com/windows/package-manager/package/manifest),
[repository submission](https://learn.microsoft.com/windows/package-manager/package/repository).
