# Consultar MongoDB com SQL no Omni-sql: exemplos e limites do suporte experimental

Você precisa investigar uma falha de processamento. Os eventos estão no MongoDB, e cada documento guarda o status, a duração e uma lista de etapas. Algumas perguntas cabem em um filtro nativo; outras ficam mais familiares em SQL, como contar falhas ou transformar as etapas em linhas.

Estou desenvolvendo o [Omni-sql](https://github.com/cccadet/omni-sql), uma IDE SQL open source. O suporte a MongoDB apresentado aqui é experimental: o editor aceita consultas nativas em Extended JSON e SELECTs em modo SQL. Dependendo da consulta, a execução fica no MongoDB ou combina MongoDB e DuckDB.

Este exemplo usa três eventos fictícios. As consultas são somente leitura; a preparação insere os documentos em um banco de demonstração separado.

## Preparar os dados e a conexão

Use uma instalação que inclua o suporte descrito em [MongoDB usage](https://github.com/cccadet/omni-sql/blob/main/docs/MONGODB.md). Os exemplos correspondem à implementação presente no tag `v0.10.1`. Consulte os [downloads](https://github.com/cccadet/omni-sql/releases) para conferir a versão disponível para seu sistema.

Baixe [events.json](https://github.com/cccadet/omni-sql/blob/main/docs/demo/mongodb/events.json) pelo botão de download do GitHub. Um dos documentos é:

```json
{
  "_id": "demo-001",
  "event_id": "demo-001",
  "status": "failed",
  "duration_ms": 1200,
  "steps": [
    { "name": "download", "duration_ms": 800 },
    { "name": "parse", "duration_ms": 400 }
  ]
}
```

Com o [mongoimport](https://www.mongodb.com/docs/database-tools/mongoimport/) instalado e um MongoDB local em execução, importe o arquivo em uma coleção nova:

```sh
mongoimport --uri="mongodb://localhost:27017/omni_sql_demo" --collection=events --file=events.json --jsonArray
```

O arquivo define os IDs para que uma segunda importação não acrescente cópias silenciosamente. Se já tiver importado, reutilize a coleção; uma tentativa de inserir os mesmos IDs gera erros de duplicidade.

No Omni-sql, crie uma conexão do tipo MongoDB com a URI `mongodb://localhost:27017/omni_sql_demo`. Para um servidor com autenticação, informe usuário e senha nos campos próprios da conexão, mantendo as credenciais fora da URI. Carregue os metadados para localizar a coleção `events`.

## Buscar um evento com uma consulta nativa

Deixe a opção SQL desativada e execute:

```json
{
  "database": "omni_sql_demo",
  "collection": "events",
  "operation": "find",
  "filter": { "event_id": "demo-001" },
  "projection": { "_id": 0, "event_id": 1, "status": 1, "duration_ms": 1 }
}
```

O resultado tem uma linha: `demo-001`, `failed`, `1200`.

Esse formato é o envelope de consulta do Omni-sql. Banco e coleção são campos separados, e o driver executa a operação no MongoDB. O editor nativo recebe Extended JSON; comandos JavaScript como `db.events.find(...)` pertencem ao mongosh e não são aceitos nesse editor.

## Fazer a mesma busca com SQL

Ative a opção SQL no editor e execute:

```sql
SELECT event_id, status, duration_ms
FROM omni_sql_demo.events
WHERE event_id = 'demo-001';
```

Essa consulta retorna os mesmos campos e valores. O SELECT está no subconjunto traduzível e é executado pelo driver no MongoDB.

Para inspecionar a tradução, volte ao modo nativo e use o comando `/mongo`:

```sql
/mongo
SELECT event_id, status, duration_ms
FROM omni_sql_demo.events
WHERE event_id = 'demo-001';
```

Clique em **Converter SQL para MongoDB**. O editor substitui o SQL pelo JSON gerado, sem executar a consulta. Você pode ler o filtro antes de executar. A ação de conversão também aceita SQL sem o prefixo `/mongo`.

## Contar os eventos por status

Em modo SQL, execute:

```sql
SELECT status, COUNT(*) AS total, AVG(duration_ms) AS avg_duration_ms
FROM omni_sql_demo.events
GROUP BY status
ORDER BY status;
```

Com a coleção contendo apenas os três documentos da demonstração, o resultado é:

| status | total | avg_duration_ms |
| --- | ---: | ---: |
| failed | 2 | 900 |
| ok | 1 | 300 |

Essa consulta também é traduzida para uma agregação no MongoDB. O subconjunto inclui `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `GROUP BY` e `HAVING`, com restrições descritas na documentação.

## Transformar as etapas de um evento em linhas

Para analisar o array `steps`, use esta consulta em modo SQL:

```sql
WITH expanded AS (
  SELECT event_id, unnest(steps) AS step
  FROM omni_sql_demo.events
  WHERE event_id = 'demo-001'
)
SELECT event_id, step.name AS step_name, step.duration_ms AS duration_ms
FROM expanded
ORDER BY duration_ms DESC;
```

O resultado esperado é:

| event_id | step_name | duration_ms |
| --- | --- | ---: |
| demo-001 | download | 800 |
| demo-001 | parse | 400 |

Aqui a execução combina dois motores. O driver filtra `event_id` no MongoDB e transfere os campos necessários para um snapshot local tipado. O DuckDB expande o array com `UNNEST`, acessa os campos da estrutura e ordena o resultado.

Use **Explain** para inspecionar o plano. Nesse caminho, ele mostra o plano nativo, a quantidade de documentos transferidos e o plano DuckDB. Explain também lê a fonte filtrada para resolver os tipos. Um índice adequado pode ajudar o filtro no servidor; confirme no plano se ele foi utilizado.

## Limites que afetam a análise

O modo SQL é somente leitura. A conversão `/mongo` cobre um subconjunto de SELECT, enquanto o caminho com DuckDB permite outras construções. Uma consulta recusada pelo conversor pode funcionar em modo SQL, mas isso depende do caminho escolhido e dos tipos dos documentos.

O conversor não expande arrays e não oferece suporte geral a joins, subconsultas ou funções de janela. Existe um caso específico de CTE com `LIMIT 1` e join na mesma coleção, detalhado na documentação; ele não representa suporte geral a joins.

No caminho combinado deste exemplo, a fonte filtrada tem limites de 100 mil documentos, 16 MiB e 60 segundos de execução no MongoDB. Exceder o limite de documentos ou bytes produz um erro explícito. O limite de prévia da interface é aplicado ao resultado final; não substitui os limites da fonte.

O planejador só envia filtros reconhecidos como seguros ao MongoDB. Outras consultas podem usar diretamente a extensão Mongo do DuckDB e ler mais documentos antes de filtrar localmente. Uma CTE, por si só, não garante que o filtro será executado no servidor.

Os tipos são inferidos a partir dos valores observados. Documentos heterogêneos, arrays vazios e coleções vazias podem exigir ajustes. No snapshot do caminho combinado, ObjectId vira texto, datas viram TIMESTAMP em UTC e Int64 mantém a precisão. Decimal128 fica como texto para evitar perda de precisão; operações numéricas sobre esse valor exigem uma decisão explícita de conversão.

Strings numéricas continuam sendo strings. Também há uma particularidade do modo SQL: uma igualdade enviada ao MongoDB pode corresponder a um elemento de array, seguindo a semântica nativa. Para buscar especificamente em listas, a documentação mostra exemplos com `list_contains`.

O [guia de MongoDB](https://github.com/cccadet/omni-sql/blob/main/docs/MONGODB.md) descreve os caminhos e restrições em mais detalhe. Os [arquivos da demonstração](https://github.com/cccadet/omni-sql/tree/main/docs/demo/mongodb) incluem os dados, consultas e resultados esperados. Se encontrar uma diferença ao reproduzir, abra uma issue com a versão do aplicativo, a consulta e documentos fictícios que representem o caso.
