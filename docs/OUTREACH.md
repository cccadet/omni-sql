# Local analysis launch and feedback

Publication sequence, channel materials, and readiness checks:
[Publication plan](PUBLICATION-PLAN.md).

## Message

Write for analysts and developers who receive a spreadsheet exported as CSV,
or a CSV/Parquet export, and need to investigate it with SQL inside their IDE.
Lead with importing and querying the file locally, without loading it into a
source database or writing a separate script. Joining it with database results
is a further step. Use [the reproducible demo](demo/README.md) and its GIF as a
small fictional example of that capability. Keep MCP and autocomplete for
separate technical posts. Do not imply native XLSX support.

## Show HN draft

Title: Show HN: omni-sql, a SQL IDE with local DuckDB analysis for CSV and Parquet

I'm building omni-sql, a SQL IDE with embedded DuckDB for local analysis.
One use case is receiving a CSV or Parquet export from someone else and needing
to inspect it with SQL. You can import the file and query it inside the IDE,
without loading it into your source database or writing a separate script.
You can also join it with an imported database query result.

In the demo, I query fictional sales data on PostgreSQL and import the complete
result into DuckDB. Then I add a targets CSV and run a join to find the region
that missed its target. The CSV stays out of PostgreSQL. The repository includes
the SQL and CSV if you want to try the same example.

The desktop app runs locally and doesn't require an account. It's MIT licensed,
with Windows x64, Debian/Ubuntu amd64, and macOS 15+ installers for Apple
Silicon and Intel that include the runtimes.
It connects to PostgreSQL, MySQL, MariaDB, SQL Server, and Oracle. Generic JDBC
is experimental. The macOS builds use ad-hoc signing and are not notarized;
the README explains the first launch.

The project is still early. Full imports have resource limits; if you import a
sample, your analysis covers that sample. The docs describe precision constraints
and record which data was imported.

Repo, demo, and downloads: https://github.com/cccadet/omni-sql

If you try it, could you share your OS and whether you could import and query
your file? If you also used a database, I'd like to hear which one. The first-run
form in Issues is a good place to report problems. I'd also like to hear where
this would fit alongside your current SQL editor.

## LinkedIn draft (Portuguese)

Você recebe um CSV de outro time e precisa investigar os dados: conferir
duplicidades, agrupar registros ou comparar com outra exportação. Para uma
análise pontual, fazer uma carga no banco ou escrever um script à parte pode
dar mais trabalho do que a consulta.

Estou desenvolvendo o omni-sql, uma IDE SQL com DuckDB integrado. Dá para
importar um CSV ou Parquet e consultar com SQL na própria IDE. Uma planilha
recebida de alguém também entra nesse fluxo se for exportada como CSV.

Se precisar cruzar o arquivo com dados de um banco, você pode importar o resultado
de uma consulta e fazer o join localmente. A demo mostra esse passo com dados
fictícios de vendas e metas. O arquivo não precisa ser carregado no banco de
origem.

O projeto é open source e roda no computador, sem exigir conta. Já tem
instaladores para Windows x64, Debian/Ubuntu amd64 e macOS 15+ (Apple Silicon
e Intel). No Mac, a primeira abertura precisa ser autorizada conforme as
instruções do README. Ainda está no começo;
deixei o exemplo e as limitações de importação na documentação.

Código, exemplo e download: https://github.com/cccadet/omni-sql

Se testar com uma exportação que precisa analisar, me conte se conseguiu
importar e consultar o arquivo e o que fez falta. Tem um formulário de primeiro
uso nas Issues para relatar problemas.

## Reddit draft

Title: Querying CSV and Parquet exports inside a SQL IDE with DuckDB

I'm building omni-sql, an open-source SQL IDE with embedded DuckDB. If someone
sends you a CSV or Parquet export to investigate, you can import it and query it
with SQL inside the IDE. There's no need to load the file into your source
database or write a separate script. Spreadsheets fit this workflow when
exported as CSV.

You can also import a database query result and join it with the file locally.

The demo uses fictional sales rows from PostgreSQL and a targets CSV. You import
the complete query result into DuckDB, add the CSV, and run the join locally.
Here's the SQL, CSV, and expected result:
https://github.com/cccadet/omni-sql/tree/main/docs/demo

There are installers for Windows x64, Debian/Ubuntu amd64, and macOS 15+
(Apple Silicon and Intel). The macOS builds use ad-hoc signing and are not
notarized; the README explains the first launch. The project is still early. The docs explain how full imports and samples
affect what you can conclude from the results.

How do you investigate files people send you today? If you try the app, I'd like
to hear whether you could install it and query a file, and what was missing.
That would help me decide what to work on next.

Read each community's current rules before posting. Publish only where project
links/self-promotion are allowed. These are drafts, not published posts.

## Measurement

Record GitHub Traffic visitors, clones, and referring sites before publication,
and compare snapshots after 7 and 14 days. Keep raw Traffic snapshots local.
The published URLs and dates are recorded in [the publication plan](PUBLICATION-PLAN.md).

Download counters include repeat downloads and tests; they do not measure
unique installations or active users. Referrers can be incomplete, and posts
published close together cannot be attributed precisely. No application
telemetry is added by this plan.
