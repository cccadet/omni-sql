# Connections

Connections live in the backend's local database; passwords are stored in the
OS keyring (Windows Credential Manager, macOS Keychain or the Linux secret
service) and never leave it.

## Switching connections

The connection switcher in the header (**Ctrl+Alt+O**) lists recent
connections first, then folders. Type to filter by name or host. Each entry has
actions to connect, edit, duplicate or remove the connection. Connections and
folders are sorted alphabetically, ignoring case and accents, with numbers in
natural order (`db2` before `db10`). **New connection** opens the connection
dialog.

## Creating a connection

The connection dialog walks through:

1. **Database type:** PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB,
   S3, generic JDBC or ODBC.
2. **Connection details:** host, port, database or service, user and password,
   or a JDBC URL / ODBC connection string.
3. **Options:** folder, environment, SSL, **MCP access** and which schemas to
   load.

**Test connection** shows the result in a banner before you save. Closing the
dialog with unsaved changes asks for confirmation.

Per-database fields and limitations are listed in
[Database support](DATABASE-SUPPORT.md). S3 and DuckLake settings are described
in [Local analysis](LOCAL-ANALYSIS.md).

## Folders

Open **Manage connections** to create and rename folders, and to move
connections in bulk: select them, or drag whole rows onto a folder.

## Environments

Tag a connection with an environment so you always know where you are. The
badge appears in the header, in the switcher and on editor tabs, in the
environment's color.

Development, Staging and Production exist by default. Choose **Environments…**
in the connection dialog or in Manage connections to add your own (for example
QA), rename them, change their color, reorder them or remove them.
**Restore defaults** brings back the original three. The list is stored on this
computer and is not included in connection exports. If you remove an
environment that connections use, they show no environment until you pick
another.

## MCP access

Each connection controls what AI assistants connected through MCP can do with
it: **Off**, **Read-only** (default) or **Read and write**. See
[MCP integration](MCP.md#per-connection-access).

## Export and import

In **Manage connections**, select connections and choose **Export** to save
them to an omni-sql JSON file (**Import…** is next to it). The export keeps label, type, endpoint, user,
folder, environment, MCP access, SSL and selected schemas. Passwords are never
exported.

**Import** accepts an omni-sql export or DBeaver's `data-sources.json`, with a
preview to choose which connections to bring in:

- Existing connections are flagged; folders are reused or created.
- DuckLake catalogs are re-linked to PostgreSQL connections imported in the same
  batch.
- DBeaver PostgreSQL, MySQL, MariaDB, SQL Server and Oracle connections are
  supported; others are listed with the reason they were skipped.
- DBeaver's `credentials-config.json` can also be read to fill in users and
  passwords. It is decrypted in memory and passwords go straight to the keyring.

## Metadata

omni-sql caches schemas, tables, columns and other objects per connection to
power the sidebar and completion. Refresh a connection's metadata from the
sidebar after schema changes. With the sidebar open, **Ctrl+P** searches
database objects.
