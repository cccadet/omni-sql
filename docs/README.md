# Documentation

These files are published as the documentation site at
**https://cccadet.github.io/omni-sql/docs/**, with navigation and search. They
also read fine here on GitHub.

## Using omni-sql

| Guide | What it covers |
| --- | --- |
| [Installation](INSTALL.md) | Packages per platform, macOS first launch, portable Windows copy, data locations |
| [Getting started](GETTING-STARTED.md) | From a file or a connection to your first query |
| [SQL editor](SQL-EDITOR.md) | Running SQL, completion, CTE preview, templates, results and plans |
| [Connections](CONNECTIONS.md) | Switcher, folders, environments, export and import |
| [Local analysis](LOCAL-ANALYSIS.md) | DuckDB imports, samples, S3, exports and data provenance |
| [MongoDB](MONGODB.md) | Native queries, `/mongo` conversion and SQL mode |
| [MCP integration](MCP.md) | Connecting AI clients, permissions and security model |
| [Database support](DATABASE-SUPPORT.md) | Supported databases, generic JDBC and ODBC limits |
| [Keyboard shortcuts](SHORTCUTS.md) | Editor, workspace and results grid |
| [Troubleshooting](TROUBLESHOOTING.md) | Connection, sidecar, port and build problems |
| [Tutorial: database + CSV](demo/README.md) | Reproducible local-analysis example |
| [Tutorial: MongoDB com SQL](TUTORIAL-MONGODB-SQL.md) | MongoDB walkthrough (in Portuguese) |

## Contributing

| Guide | What it covers |
| --- | --- |
| [Development](DEVELOPMENT.md) | Local setup, dev workflows and the docs site |
| [Architecture](ARCHITECTURE.md) | Processes, components and the local analysis engine |
| [Testing and release gates](TESTING.md) | Hooks, coverage, CI and integration evidence |
| [Building and releasing](BUILDING.md) | Packaging resources, installers and the release workflow |
| [Release notes](releases/) | One file per version; [template](releases/TEMPLATE.md) |

Project conventions for contributors and coding agents live in
[CLAUDE.md](../CLAUDE.md). Other READMEs cover the
[JVM sidecar](../services/jvm-sidecar/README.md),
[test databases](../docker/test-dbs/README.md),
[website](../website/README.md) and
[WinGet manifests](../distribution/winget/README.md).
