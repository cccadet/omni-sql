# Validação dos exemplos do tutorial MongoDB

Data: 12/10/2026. Código consultado: `be5a9250c6047b37ee0edd6f32d4df462c16576c`, com os novos arquivos de documentação ainda na árvore de trabalho. As funcionalidades descritas também constam na documentação do tag `v0.10.1`.

Ambiente: Node.js 26.8.1, imagem local oficial `mongo:8`, DuckDB Python 1.4.4. O MongoDB temporário usou apenas dados fictícios e a porta local 27127; foi encerrado após a validação.

| Exemplo | Verificação | Resultado |
| --- | --- | --- |
| `native-find.json` | Execução pelo driver MongoDB contra os três documentos | Igual a `expected.json` |
| SELECT com filtro | Tradução por `mongoSqlToNative`, execução no MongoDB | Igual a `expected.json` |
| GROUP BY | Tradução por `mongoSqlToNative`, execução no MongoDB | Contagens 2/1, médias 900/300 |
| CTE com UNNEST | Plano por `mongoSqlSourcePlan`, filtro e projeção no MongoDB, snapshot por `mongoSqlSnapshot` | Um documento transferido |
| Expansão do snapshot | `from_json_strict` no DuckDB, seguido do SQL reescrito pelo planejador | Etapas `download`/800 e `parse`/400 |

Comandos usados para os verificadores temporários:

```text
rtk proxy node .cache/mongo-tutorial-check.mjs
rtk proxy powershell -NoProfile -Command "& 'C:/Users/ccsantos/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' .cache/mongo-tutorial-check.py"
```

Os verificadores leram os SELECTs do artigo e compararam os resultados com `expected.json`. Os arquivos temporários ficam em `.cache`; os dados e consultas reproduzíveis estão nesta pasta.

Esta verificação cobre os exemplos e o caminho de transformação dos dados. Não executou o aplicativo desktop, a ponte Tauri ou a extensão Mongo do DuckDB, nem certifica o comportamento de uma instalação completa. Nenhum gate de código foi executado: a alteração contém apenas documentação e exemplos.
