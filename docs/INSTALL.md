# Installation

Download the package for your platform from the
[latest release](https://github.com/cccadet/omni-sql/releases/latest) and verify
it against the release's `SHA256SUMS` if you want. Node.js, Java and the ODBC
driver manager are bundled; you do not need a database client. Generic JDBC and
ODBC connections still need their database drivers
(see [Database support](DATABASE-SUPPORT.md)).

## Windows

The `.exe` installer installs for the current user and provisions the WebView2
runtime when it is missing. Installed copies update themselves.

The `x64-portable.zip` archive runs without an installer or administrator
rights. Extract the whole `omni-sql` folder (running it from inside the ZIP does
not work) and start `omni-sql.exe`. It needs the Microsoft Edge WebView2
runtime, which Windows 11 and current Windows 10 already include. When an update
is available, the portable copy opens the release page: close omni-sql, extract
the new archive and replace the old folder.

## Linux (Debian/Ubuntu amd64)

Install the `.deb` with `sudo apt install ./omni-sql_<version>_amd64.deb`; `apt`
pulls in dependencies such as `libodbc2`. Desktop notifications need a
notification service (GNOME, KDE, Xfce and Cinnamon include one; minimal window
managers need one such as `dunst` or `mako`).

## macOS 15+

Choose `aarch64.dmg` for Apple Silicon or `x64.dmg` for Intel. Open the disk
image, drag **omni-sql** to **Applications**, and launch it from there.

The builds use a free ad-hoc signature and are not notarized by Apple. If macOS
blocks the first launch, open **System Settings → Privacy & Security → Open
Anyway** and confirm, following
[Apple's instructions](https://support.apple.com/102445). No Apple account is
needed.

## Where data is stored

Connections and passwords are shared between an installed and a portable copy
on the same account. On Windows:

| Data | Location |
| --- | --- |
| Tabs, history, theme, environments and editor settings | `%LOCALAPPDATA%\dev.omnisql` (WebView storage) |
| Logs | `%LOCALAPPDATA%\dev.omnisql\logs` |
| Local DuckDB datasets and runtime cache | `%APPDATA%\dev.omnisql` |
| Connections and metadata cache | `%USERPROFILE%\.local\share\omni-sql` |
| Passwords | Windows Credential Manager |

On Linux and macOS, passwords use the system keyring and the other data lives
in the platform's application data directories for `dev.omnisql`.

Copying the program folder to another machine does not move connections or
passwords; use **Manage connections → Export** instead (passwords are not
exported). To remove omni-sql completely, uninstall it (or delete the portable
folder) and delete the locations above.
