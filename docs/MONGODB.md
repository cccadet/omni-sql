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

Joins, subconsultas, CTEs, funções escalares, janelas, `DISTINCT`, `OFFSET`, `LIKE`, modificadores de agregação e `NULLS FIRST/LAST` explícitos não são suportados. A conversão mostra o motivo e preserva o SQL original. Se o editor, a conexão ou o modo mudar durante a conversão, o resultado não sobrescreve a edição atual.

O modo **SQL** executa SELECTs suportados diretamente no MongoDB, sem exigir conversão manual para JSON. Consultas mais complexas usam DuckDB. O plano de execução acompanha o motor escolhido.

Nesse modo, a igualdade usa a busca nativa do MongoDB: encontra tanto um valor escalar quanto um elemento de array e pode aproveitar o índice do campo.

```sql
SELECT * FROM base_laudos.padronizacao
WHERE id_guia = '52712827';
```

`list_contains(id_guia, '52712827')` também é enviado ao MongoDB, com `$elemMatch`, para buscar especificamente em arrays. Os limites de resultados e o cancelamento continuam disponíveis em ambos os caminhos.

Nas consultas que precisam do fallback DuckDB, um campo inferido como array não pode ser comparado diretamente a um texto com `=`. Para buscar um elemento, use `list_contains`:

```sql
SELECT * FROM base_laudos.padronizacao
WHERE list_contains(id_guia, '52712827');
```

Essa consulta serve para `id_guia` inferido como uma lista de textos (`VARCHAR[]`). Os tipos dos valores devem corresponder aos tipos dos elementos da lista.

Os metadados do resultado preservam o tipo dos elementos das listas, inclusive listas aninhadas. Quando o DuckDB informa os tipos de uma conversão inválida, a mensagem mostra o tipo fornecido e o tipo esperado, por exemplo `VARCHAR` e `VARCHAR[]`. Esses tipos vêm da inferência da extensão sobre documentos amostrados.
