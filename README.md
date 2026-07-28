<p align="center">
  <img src="omni-sql.svg" alt="omni-sql logo" width="96" />
</p>

<h1 align="center">omni-sql</h1>

<p align="center">One focused desktop SQL workspace for every database.</p>

<p align="center">
  <a href="https://github.com/cccadet/omni-sql/releases/latest"><strong>Download latest release</strong></a>
</p>

<p align="center">
  <a href="https://github.com/cccadet/omni-sql/actions/workflows/ci.yml"><img src="https://github.com/cccadet/omni-sql/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://github.com/cccadet/omni-sql/releases/latest"><img src="https://img.shields.io/github/v/release/cccadet/omni-sql" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
</p>

## Overview

omni-sql is a local desktop SQL IDE for PostgreSQL, MySQL, MariaDB, SQL Server,
and Oracle. It keeps query writing, database browsing, execution, and results
in one clear workspace.

## Features

- Metadata-backed autocomplete for tables, columns, CTE names, and CTE columns
- SQL diagnostics with dialect-transpilation quick fixes
- Schema browser with columns, keys, indexes, functions, and object definitions
- Integrated textual `EXPLAIN` for native relational connections
- Inline edits only when primary-key checks establish a safe update path
- Generic JDBC connections with a user-supplied driver JAR (experimental)

## Database support

| Database | Support |
| --- | --- |
| <img src="docs/images/database-icons/postgres.svg" alt="" width="18" height="18" /> PostgreSQL | <span style="color: green;">✅ Supported</span> |
| <img src="docs/images/database-icons/mysql.svg" alt="" width="18" height="18" /> MySQL | <span style="color: green;">✅ Supported</span> |
| <img src="docs/images/database-icons/mariadb.svg" alt="" width="18" height="18" /> MariaDB | <span style="color: green;">✅ Supported</span> |
| <img src="docs/images/database-icons/sqlserver.svg" alt="" width="18" height="18" /> SQL Server | <span style="color: green;">✅ Supported</span> |
| <img src="docs/images/database-icons/oracle.svg" alt="" width="18" height="18" /> Oracle | <span style="color: green;">✅ Supported</span> |
| <img src="docs/images/database-icons/jdbc-generic.svg" alt="" width="18" height="18" /> Generic JDBC | Experimental |

Generic JDBC requires a JDBC URL, driver JAR, and driver class supplied by the
user. It currently provides limited query execution and basic metadata only;
plans, indexes, definitions, and row edits are not available.

## Install

Download [v0.1.11](https://github.com/cccadet/omni-sql/releases/latest). No
Node.js, Java, Rust, database client, or other SDK is required for end users.

Available release assets:

- **Windows x64:** [`omni-sql_0.1.11_x64-setup.exe`](https://github.com/cccadet/omni-sql/releases/latest/download/omni-sql_0.1.11_x64-setup.exe) — run installer, then launch omni-sql.
- **Linux amd64:** [`omni-sql_0.1.11_amd64.deb`](https://github.com/cccadet/omni-sql/releases/latest/download/omni-sql_0.1.11_amd64.deb) — install with `sudo apt install ./omni-sql_0.1.11_amd64.deb`, then launch from applications.
- **Checksums:** [`SHA256SUMS`](https://github.com/cccadet/omni-sql/releases/latest/download/SHA256SUMS) — optionally verify with `sha256sum -c SHA256SUMS` on Linux or `Get-FileHash .\omni-sql_0.1.11_x64-setup.exe` on Windows.

No macOS, ARM, MSI, AppImage, or portable package is provided.

## Quick start

1. Install the package for your platform.
2. Open omni-sql and create a connection.
3. Select database type, enter connection details, and use **Test connection**.
4. Choose SSL and schema settings where needed.
5. Browse or reload metadata, open a SQL tab, and start writing.
6. Run the selection or current statement. Inspect, filter, sort, page, or export results.

## Current status

v0.1.11 is the latest release. Native database adapters listed above are
available. Generic JDBC is experimental and intentionally limited.

Planned user-facing support:

- ODBC
- MongoDB

## Screenshots and demo

Existing images are annotated development references. A clean hero screenshot
has not yet been captured.

Capture specification: **1440×900**, generic sample data, showing a database
connection, SQL query, autocomplete suggestions, and query results in one
cohesive view.

## Documentation

- [Database support and connections](docs/DATABASE-SUPPORT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- **Developer docs:** [Development](docs/DEVELOPMENT.md), [Building](docs/BUILDING.md), [Architecture](docs/ARCHITECTURE.md)
- Português (Brasil) — translation planned; not yet available

## Built with

Built with Tauri, React, Fluent UI, and Monaco Editor.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

## License

[MIT](LICENSE)
