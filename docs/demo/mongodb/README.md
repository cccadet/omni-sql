# Demonstração: MongoDB nativo e SQL

Dados fictícios de eventos de processamento para o [tutorial](../../TUTORIAL-MONGODB-SQL.md).

1. Em um MongoDB local, importe `events.json` em uma coleção nova:

   ```sh
   mongoimport --uri="mongodb://localhost:27017/omni_sql_demo" --collection=events --file=docs/demo/mongodb/events.json --jsonArray
   ```

2. Conecte o Omni-sql ao banco `omni_sql_demo`.
3. Execute `native-find.json` no modo nativo.
4. Ative SQL e execute cada consulta de `queries.sql` separadamente.
5. Compare os valores com `expected.json`.

Os IDs são fixos. Reutilize a coleção depois da primeira importação; repetir a inserção gera erros de duplicidade. As consultas não modificam os documentos. A coleção deve conter apenas os três eventos para reproduzir a agregação esperada.

O exemplo corresponde à implementação do tag `v0.10.1`. O terceiro SELECT usa filtro nativo no MongoDB e snapshot tipado no DuckDB. Use Explain para conferir o caminho e os documentos transferidos. O suporte é experimental; os limites estão no tutorial e em [MONGODB.md](../../MONGODB.md).
