# Rascunhos: MongoDB nativo e SQL

Preparados, revisados e publicados em 13/10/2026, na execução agendada para 12h (America/Sao_Paulo). O tutorial já está disponível no GitHub.

## Publicações confirmadas

- [LinkedIn](https://www.linkedin.com/feed/update/urn:li:activity:7515789265084112897/): publicação concluída confirmada pela interface, na conta de Cristian Carlos Dos Santos.
- [Reddit, r/mongodb](https://www.reddit.com/r/mongodb/comments/1x4z2yb/im_experimenting_with_native_mongodb_queries_and/): post visível com texto, SQL formatado e link para o tutorial, pela conta u/cccadet.

A página de regras de r/mongodb e o formulário não exibiram regras específicas adicionais ou restrições de autopromoção/IA. A comunidade se apresenta como espaço para notícias, artigos e assuntos sobre MongoDB. As publicações anteriores das contas foram conferidas antes do envio para evitar duplicatas. Nenhum outro subreddit recebeu este post.

Provas locais: `.cache/publication-proof/linkedin-mongodb-2026-10-13.png` e `.cache/publication-proof/reddit-mongodb-2026-10-13.png`.

## LinkedIn, português

Você está investigando uma falha de processamento. Os eventos estão no MongoDB: cada documento tem um status, uma duração e um array com as etapas executadas.

Estou desenvolvendo suporte experimental a MongoDB no Omni-sql, minha IDE SQL open source. Na mesma conexão, dá para usar consultas nativas em Extended JSON ou ativar o modo SQL, somente leitura.

Para buscar um evento, o filtro nativo é:

{"event_id": "demo-001"}

No modo SQL, a busca pelos campos do evento fica assim:

SELECT event_id, status, duration_ms
FROM omni_sql_demo.events
WHERE event_id = 'demo-001';

Esse SELECT é traduzido e executado no MongoDB. O filtro acima faz parte do JSON de consulta da IDE; o exemplo completo está no tutorial.

Para expandir o array de etapas, o exemplo combina os dois motores: filtra o evento no MongoDB e usa DuckDB localmente para transformar as etapas em linhas. Explain permite conferir o caminho de execução.

Escrevi um tutorial com eventos fictícios, consultas e resultados esperados. Também expliquei os limites da tradução, da inferência de tipos e da transferência de documentos:

https://github.com/cccadet/omni-sql/blob/main/docs/TUTORIAL-MONGODB-SQL.md

Em quais investigações sobre dados do MongoDB você sente falta de usar SQL?

## Reddit, inglês

Título: I'm experimenting with native MongoDB queries and read-only SQL in the same open-source IDE

I'm the author of Omni-sql, an open-source SQL IDE. I've been adding experimental MongoDB support, with native Extended JSON queries and a read-only SQL mode on the same connection.

The example I wrote uses fictional processing events: each document has a status, a duration, and an array of steps. This query counts the events by status:

    SELECT status, COUNT(*) AS total, AVG(duration_ms) AS avg_duration_ms
    FROM omni_sql_demo.events
    GROUP BY status
    ORDER BY status;

That SELECT is translated to a MongoDB aggregation and executed through the native driver. In native mode, `/mongo` lets you inspect the generated JSON before running it. The native editor accepts an Extended JSON query envelope, rather than mongosh JavaScript.

An array expansion takes a different path:

    WITH expanded AS (
      SELECT event_id, unnest(steps) AS step
      FROM omni_sql_demo.events
      WHERE event_id = 'demo-001'
    )
    SELECT event_id, step.name AS step_name, step.duration_ms AS duration_ms
    FROM expanded
    ORDER BY duration_ms DESC;

For this query, the driver filters the event in MongoDB and transfers the required fields into a typed local snapshot. DuckDB expands the array and sorts the result. Explain shows both plans and the number of documents transferred.

The SQL-to-native translator supports a subset of SELECT. Other SQL queries may use DuckDB, and filter pushdown depends on the query shape. For the combined path above, the source is bounded to 100,000 documents, 16 MiB, and 60 seconds of MongoDB execution. Heterogeneous documents and empty arrays can also affect type inference.

[Tutorial with sample documents, expected results, and limitations](https://github.com/cccadet/omni-sql/blob/main/docs/TUTORIAL-MONGODB-SQL.md) (in Portuguese; SQL and JSON examples included).

For people who investigate MongoDB data: which queries would make this useful in your workflow, and which document shapes would you want to test first?

## Preparação para publicar

O LinkedIn recebe o texto em formato simples; os trechos SQL acima não dependem de Markdown. No Reddit, manter a indentação de quatro espaços nos blocos de código.

Escolher uma comunidade pertinente e conferir suas regras atuais antes da publicação. O texto declara autoria e suporte experimental. O tutorial está em português; a versão do Reddit informa isso junto ao link.

Uma imagem real da consulta e do resultado pode acompanhar o LinkedIn, depois de capturada e conferida. Não há imagem preparada nesta etapa.
