<p align="center"><img src="omni-sql.svg" alt="omni-sql logo" width="96" /></p>
<h1 align="center">omni-sql</h1>
<p align="center"><strong>One focused SQL workspace for every database.</strong></p>
<p align="center">A modern, open-source desktop SQL IDE for developers working across<br />PostgreSQL, MySQL, MariaDB, SQL Server, and Oracle.</p>
<p align="center"><a href="https://github.com/cccadet/omni-sql/releases/latest"><strong>Download omni-sql</strong></a> · <a href="#quick-start">Quick start</a> · <a href="docs/DATABASE-SUPPORT.md">Database support</a></p>
<p align="center"><strong>Runs locally · No account required · No separate runtime or database client to install</strong></p>
<p align="center">
  <a href="https://github.com/cccadet/omni-sql/actions/workflows/ci.yml"><img src="https://github.com/cccadet/omni-sql/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://sonarcloud.io/summary/new_code?id=cccadet_omni-sql"><img src="https://sonarcloud.io/api/project_badges/measure?project=cccadet_omni-sql&metric=alert_status" alt="Quality gate status" /></a>
  <a href="https://github.com/cccadet/omni-sql/releases/latest"><img src="https://img.shields.io/github/v/release/cccadet/omni-sql" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
</p>

![Write, understand, and run SQL with CTE-aware autocomplete and dialect quick fixes](docs/images/feature_example.gif)

<p align="center"><sub>Early-stage software · Installers currently available for Windows x64 and Linux amd64</sub></p>

## One IDE instead of a tool for each database

omni-sql brings query writing, schema exploration, execution, and results into one
consistent desktop workspace. It is built for developers who move between database
engines and want useful SQL intelligence without sending their schema to a hosted service.

### What makes omni-sql different

| | Why it matters |
| --- | --- |
| **Five native database adapters** | Use the same workflow with PostgreSQL, MySQL, MariaDB, SQL Server, and Oracle. |
| **CTE-aware autocomplete** | Complete CTE names and projected columns alongside metadata-backed tables and columns. |
| **Dialect intelligence** | Turn supported dialect diagnostics into database-compatible SQL through editor quick fixes. |
| **Local desktop workflow** | Connections, metadata, queries, and results stay in the desktop application; no account is required. |
| **Safety-minded editing** | Inline row edits are enabled only when primary-key checks establish a safe update path. |
| **Ready-to-run installers** | Release packages bundle the required runtimes; users do not install Node.js, Java, Rust, or vendor client SDKs. |

## From connection to result

1. **Connect** to one of the supported databases.
2. **Explore** schemas, tables, columns, keys, indexes, functions, and definitions.
3. **Write** in a Monaco-powered editor with metadata and CTE-aware completion.
4. **Run and analyze** statements, results, messages, exports, and supported execution plans.

## Database support

| Database | Connection | Metadata autocomplete | Query execution |
| --- | :---: | :---: | :---: |
| <img src="docs/images/database-icons/postgres.svg" alt="" width="18" height="18" /> PostgreSQL | ✅ | ✅ | ✅ |
| <img src="docs/images/database-icons/mysql.svg" alt="" width="18" height="18" /> MySQL | ✅ | ✅ | ✅ |
| <img src="docs/images/database-icons/mariadb.svg" alt="" width="18" height="18" /> MariaDB | ✅ | ✅ | ✅ |
| <img src="docs/images/database-icons/sqlserver.svg" alt="" width="18" height="18" /> SQL Server | ✅ | ✅ | ✅ |
| <img src="docs/images/database-icons/oracle.svg" alt="" width="18" height="18" /> Oracle | ✅ | ✅ | ✅ |
| <img src="docs/images/database-icons/jdbc-generic.svg" alt="" width="18" height="18" /> Generic JDBC | 🧪 Experimental | Basic | Limited |

Generic JDBC uses a driver JAR, JDBC URL, and driver class supplied by the user.
Plans, indexes, definitions, and row edits are not currently available for generic JDBC.
See the [database support guide](docs/DATABASE-SUPPORT.md) for connection details and limitations.

## Install

Download the package for your platform from the **[latest GitHub release](https://github.com/cccadet/omni-sql/releases/latest)**.

| Platform | Package | Status |
| --- | --- | --- |
| Windows 10/11 x64 | `.exe` installer | Available |
| Debian/Ubuntu amd64 | `.deb` package | Available |
| macOS, ARM, AppImage, RPM | — | Not packaged yet |

Release assets include a `SHA256SUMS` file so downloads can be verified. End users
do not need to install Node.js, Java, Rust, a database client, or a vendor client SDK.

> omni-sql is early-stage software. Test it with development data before using it
> against important environments, and please report unexpected behavior.

## Quick start

1. Install the package for your platform.
2. Open omni-sql and create a connection.
3. Select a database type, enter the connection details, and choose **Test connection**.
4. Configure SSL and schema settings when needed, then connect.
5. Browse metadata or open a SQL tab and start writing.
6. Run the selection or current statement, then inspect, filter, sort, page, or export the results.

Need help connecting? Read [Database support](docs/DATABASE-SUPPORT.md) or [Troubleshooting](docs/TROUBLESHOOTING.md).

## Features in action

### Complete columns projected by a CTE

![CTE column autocomplete](docs/images/CTE_columns.png)

omni-sql combines database metadata with the SQL in the editor to suggest columns
projected by common table expressions.

### Adapt SQL through a dialect quick fix

<p><img src="docs/images/transpile_02.png" alt="PostgreSQL dialect-transpilation quick fix" width="49%" /> <img src="docs/images/transpile_03.png" alt="Transpiled PostgreSQL query" width="49%" /></p>

Supported diagnostics can offer a quick fix that rewrites the statement for the
active database dialect without leaving the editor.

## Positioning

omni-sql is intentionally a focused SQL IDE, not a full database administration suite.
It is a good fit when you value a consistent cross-database editor, local operation,
CTE-aware completion, and guarded data edits. Mature tools such as DBeaver and DataGrip
cover broader administration and ecosystem needs; omni-sql focuses on a smaller,
modern workflow and is free and open source.

| Choose omni-sql when you want… | Consider a broader tool when you need… |
| --- | --- |
| One editor across five major relational databases | Deep vendor-specific administration |
| CTE and metadata-aware SQL completion | A large plugin ecosystem or enterprise support |
| A local desktop app with no account | Built-in data modeling, migration, or team features |
| An MIT-licensed project you can inspect and contribute to | An established, long-supported product |

## MCP integration

omni-sql includes a local MCP server that lets a compatible AI client inspect the
active workspace and propose SQL edits. Proposed edits always require explicit
approval in omni-sql. See [MCP documentation](docs/MCP.md) for setup, transports,
available tools, and security details.

## Roadmap

- ✅ Native PostgreSQL, MySQL, MariaDB, SQL Server, and Oracle adapters
- ✅ CTE-aware autocomplete
- 🧪 Generic JDBC (experimental)
- 📋 ODBC
- 📋 MongoDB (deferred to v2)
- 📋 More installer formats and platforms

## Documentation

- [Database support and connections](docs/DATABASE-SUPPORT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [MCP integration](docs/MCP.md)
- [Development](docs/DEVELOPMENT.md)
- [Building](docs/BUILDING.md)
- [Architecture](docs/ARCHITECTURE.md)

Built with Tauri, React, Fluent UI, Monaco Editor, TypeScript, Rust, and Kotlin.

## Help the project grow

If omni-sql is useful to you, **[star the repository](https://github.com/cccadet/omni-sql)**
to help other developers discover it. Bug reports, database compatibility notes, and
focused pull requests are welcome—please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

[MIT](LICENSE)
