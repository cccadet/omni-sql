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

O modo **SQL via DuckDB** continua disponível para consultas SQL que não precisam gerar JSON nativo.

No SQL via DuckDB, um campo MongoDB que contém um array não pode ser comparado diretamente a um texto com `=`. Para buscar um elemento, use `list_contains`:

```sql
SELECT * FROM base_laudos.padronizacao
WHERE list_contains(id_guia, '52712827');
```

Essa consulta serve para `id_guia` inferido como uma lista de textos (`VARCHAR[]`). Os tipos dos valores devem corresponder aos tipos dos elementos da lista.

Os metadados do resultado preservam o tipo dos elementos das listas, inclusive listas aninhadas. Quando o DuckDB informa os tipos de uma conversão inválida, a mensagem mostra o tipo fornecido e o tipo esperado, por exemplo `VARCHAR` e `VARCHAR[]`. Esses tipos vêm da inferência da extensão sobre documentos amostrados.
