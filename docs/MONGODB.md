# MongoDB nativo e conversão de SQL

No modo nativo, as consultas usam Extended JSON. Banco e coleção são campos separados:

```json
{
  "database": "base_laudos",
  "collection": "padronizacao",
  "operation": "find",
  "filter": {"id_guia": "52712827"}
}
```

O autocomplete sugere operações, bancos, coleções, campos, operadores e estágios comuns de agregação. Os campos vêm dos metadados carregados, que amostram até 100 documentos por coleção.

A tabela mostra ObjectIds como texto e datas BSON em ISO 8601 UTC (`Z`), sem os envelopes `$oid` e `$date`. Números BSON também aparecem sem envelopes, preservando todos os dígitos, inclusive dentro de arrays e objetos. O filtro e a ordenação usam os valores exibidos. Ao passar o mouse sobre uma célula estruturada, o valor original aparece; a edição e a exportação CSV preservam o Extended JSON original.

No caminho nativo, os tipos das colunas são inferidos dos documentos retornados; a barra lateral usa a amostra de até 100 documentos já carregada. ObjectId, datas, textos, booleanos, números e binários têm tipos próprios. Listas mostram o tipo dos elementos (`VARCHAR[]`, por exemplo). Nulos e listas vazias não substituem um tipo conhecido; tipos numéricos diferentes são indicados como `NUMERIC`, e tipos incompatíveis ou desconhecidos como `JSON`. Essa inferência descreve os valores observados, não impõe um esquema à coleção. No caminho DuckDB, os tipos continuam vindo dos metadados da consulta executada.

Atualize os metadados para recarregar tipos que já estavam em cache na barra lateral. A importação de resultados estruturados em “Analisar localmente” mantém o snapshot em JSON, preservando os envelopes BSON e a precisão numérica.

## `/mongo`: converter SELECT para JSON nativo

No editor de uma conexão MongoDB em modo nativo, escreva:

```sql
/mongo
SELECT status, COUNT(*) AS total, SUM(valor) AS soma
FROM base_laudos.padronizacao
WHERE id_guia IN ('52712827', '52712828')
GROUP BY status
HAVING COUNT(*) > 1
ORDER BY total DESC
LIMIT 20
```

Clique em **Converter SQL para MongoDB** ou pressione **Ctrl+Enter** (Command+Enter no macOS). O comando substitui o SQL por JSON nativo, sem executar a consulta. Uma execução posterior usa o driver MongoDB. O botão também aceita SQL sem o prefixo `/mongo`.

A conversão suporta:

- Uma coleção em `FROM banco.colecao`; sem banco explícito, usa o banco da URI da conexão.
- `SELECT *`, seleção de campos e aliases de saída.
- Comparações `=`, `<>`, `!=`, `<`, `<=`, `>`, `>=`; `AND`, `OR`, `NOT`, parênteses, `IN`, `NOT IN`, `IS NULL` e `IS NOT NULL`.
- `GROUP BY` com um ou vários campos; `COUNT(*)`, `COUNT(campo)`, `SUM`, `AVG`, `MIN` e `MAX`.
- `HAVING`, inclusive agregações não selecionadas, e `ORDER BY` com campos ou aliases.
- `LIMIT` inteiro não negativo, incluindo zero.

Consultas simples geram `find`. Aliases, agregações e `LIMIT` usam `aggregate`. O limite de linhas da interface continua limitando os resultados, mesmo quando o SQL contém `LIMIT`.

Valores ausentes são tratados como nulos em filtros e agrupamentos. `COUNT(campo)` ignora nulos/ausentes; `SUM` retorna nulo quando todos os valores são nulos. Uma agregação global sem linhas retorna uma linha, com contagem zero e as demais agregações nulas.

A conversão destina-se a campos escalares com tipos compatíveis; não expande arrays nem faz coerção de tipos. Comparações e ordenação seguem os tipos e a ordenação nativa do MongoDB. Strings que representam números continuam sendo strings. Números inteiros fora da precisão segura de JavaScript são rejeitados.

Uma CTE não recursiva com `ORDER BY` e `LIMIT 1` pode ser ligada à mesma coleção com um `INNER JOIN`. O `ON` deve usar igualdades entre campos qualificados pelos aliases, combinadas com `AND`; as chaves devem estar selecionadas na CTE. A consulta externa seleciona e filtra os campos da coleção original:

```sql
/mongo
WITH busca_ultima AS (
  SELECT id_guia, data_evento
  FROM base_laudos.padronizacao
  ORDER BY data_evento DESC
  LIMIT 1
)
SELECT id_guia, data_evento, exames
FROM base_laudos.padronizacao p
JOIN busca_ultima bu
  ON p.id_guia = bu.id_guia AND p.data_evento = bu.data_evento
WHERE p.status = 'ok';
```

A tradução escolhe as chaves da última linha antes do join e do filtro externo. Todos os documentos com essas chaves são recuperados, inclusive duplicados; chaves nulas ou ausentes não correspondem. Empates no `ORDER BY` seguem a ordenação do MongoDB; adicione `_id` como segundo campo para desempatar quando necessário.

Outros joins e CTEs, subconsultas, funções escalares, janelas, `DISTINCT`, `OFFSET`, `LIKE`, modificadores de agregação e `NULLS FIRST/LAST` explícitos não são suportados. A conversão mostra o motivo e preserva o SQL original. Se o editor, a conexão ou o modo mudar durante a conversão, o resultado não sobrescreve a edição atual.

O modo **SQL** executa SELECTs suportados diretamente no MongoDB, sem exigir conversão manual para JSON. Consultas mais complexas usam DuckDB. O plano de execução acompanha o motor escolhido.

Consultas com uma única coleção, um filtro de igualdade ou `list_contains` na leitura da coleção e uma sequência linear de CTEs podem combinar os dois motores. O driver nativo filtra no MongoDB e busca os campos necessários; o DuckDB recebe um snapshot tipado e executa `UNNEST`, funções, filtros restantes, ordenação e agregações. `exames` mantém o tipo de lista de estruturas e `codigos` mantém o tipo de lista de textos, permitindo `exame.codigos[1]` e `unnest(exame.codigos)`. ObjectId vira texto, datas viram TIMESTAMP em UTC e Int64 mantém a precisão. Decimal128 e dados binários ficam como texto para evitar perda de precisão (binários em base64).

O limite de prévia é aplicado ao resultado final, depois da expansão e da análise. A fonte filtrada tem limites independentes de 100.000 documentos, 16 MiB e 60 segundos de execução no MongoDB. Ao exceder o limite de documentos ou bytes, a consulta falha explicitamente; não retorna uma contagem ou agregação parcial. Uma guia inexistente retorna zero linhas usando uma amostra de até 100 documentos para definir as colunas. Uma coleção vazia ou valores sem informação suficiente para inferir a estrutura podem continuar exigindo ajuste do esquema.

O planejador só antecipa predicados seguros na leitura da coleção. Ele preserva filtros residuais e não extrai apenas uma parte de um `OR`. Não move filtros externos através de `LIMIT`, agregações ou janelas. Consultas com outras topologias, como múltiplas leituras, joins e subconsultas, continuam nos caminhos existentes. No caminho combinado, Explain mostra o plano nativo, a quantidade de documentos transferidos e o plano DuckDB; essa explicação também lê a fonte filtrada para resolver os tipos.

Veja [consultas de teste com exames](examples/mongodb-exames.sql) para primeiro código, todos os códigos, descrição, filtro por código, contagem e limite final.

Nesse modo, a igualdade usa a busca nativa do MongoDB: encontra tanto um valor escalar quanto um elemento de array e pode aproveitar o índice do campo.

```sql
SELECT * FROM base_laudos.padronizacao
WHERE id_guia = '52712827';
```

`list_contains(id_guia, '52712827')` também é enviado ao MongoDB, com `$elemMatch`, para buscar especificamente em arrays. Os limites de resultados e o cancelamento continuam disponíveis em ambos os caminhos.

Nas consultas que continuam usando diretamente a extensão Mongo do DuckDB (fora do caminho combinado acima), um campo inferido como array não pode ser comparado diretamente a um texto com `=`. Para buscar um elemento, use `list_contains`:

```sql
SELECT * FROM base_laudos.padronizacao
WHERE list_contains(id_guia, '52712827');
```

Essa consulta serve para `id_guia` inferido como uma lista de textos (`VARCHAR[]`). Os tipos dos valores devem corresponder aos tipos dos elementos da lista.

Na extensão, `list_contains` pode permanecer como filtro local e ler muitos documentos. Use Explain para verificar o filtro na leitura Mongo; uma CTE não garante que o filtro seja enviado ao servidor.

Os metadados do resultado preservam o tipo dos elementos das listas, inclusive listas aninhadas. Quando o DuckDB informa os tipos de uma conversão inválida, a mensagem mostra o tipo fornecido e o tipo esperado, por exemplo `VARCHAR` e `VARCHAR[]`. Esses tipos vêm da inferência da extensão sobre documentos amostrados.
