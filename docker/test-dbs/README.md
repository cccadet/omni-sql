# omni-sql — Test Databases

Containers Docker + smoke test que valida os 4 adaptadores reais do omni-sql
(`PostgresAdapter`, `MysqlAdapter`, `MssqlAdapter`, `OracleAdapter`) contra
dados fictícios.

## Bancos suportados

| Dialeto       | Imagem                          | Porta | Usuário / Senha      |
|---------------|---------------------------------|-------|----------------------|
| PostgreSQL    | `postgres:16`                   | 5432  | `omni` / `omni`      |
| MySQL         | `mysql:8`                       | 3306  | `omni` / `omni`      |
| SQL Server    | `mssql/server:2022-latest`      | 1433  | `sa` / `Omni!2024`   |
| Oracle XE     | `gvenzl/oracle-xe:21-slim`      | 1521  | `OMNI` / `omni`      |

> Oracle XE requer aceitação da Oracle License Agreement. O `gvenzl/oracle-xe:21-slim`
> é a imagem mais leve (~2GB). Ao usar, você aceita os termos da Oracle.

## Quick start

Os testes são arquivos TypeScript executados pelo `tsx`. Isso é necessário
principalmente no Node 22, que pode não aceitar `.ts` diretamente com
`node --test`.

```bash
cd docker/test-dbs

# Na raiz do monorepo, instalar dependências uma vez
cd ../..
pnpm install

# Voltar para esta pasta
cd docker/test-dbs

# Subir todos os bancos
docker compose up -d

# Aguardar os healthchecks (~30-60s para Oracle)
docker compose ps

# Rodar smoke test em todos os bancos
pnpm exec tsx --test ./smoke-test.ts

# Derrubar tudo, incluindo os volumes e os dados de teste
docker compose down -v
```

O comando deve mostrar quatro suites (`PostgreSQL`, `MySQL`, `SQL Server` e
`Oracle XE`) e os testes individuais dentro de cada suite.

## Testes por banco

Os filtros abaixo executam apenas a suite do banco escolhido. Os containers
correspondentes precisam estar ativos.

### PostgreSQL

```bash
docker compose up -d postgres
pnpm exec tsx --test --test-name-pattern=PostgreSQL ./smoke-test.ts
```

Configuração usada pelo teste:

- Host/porta: `127.0.0.1:5432`
- Banco: `omni_test`
- Usuário/senha: `omni` / `omni`
- Schema: `public`

### MySQL

```bash
docker compose up -d mysql
pnpm exec tsx --test --test-name-pattern=MySQL ./smoke-test.ts
```

Configuração usada pelo teste:

- Host/porta: `127.0.0.1:3306`
- Banco: `omni_test`
- Usuário/senha: `omni` / `omni`

### SQL Server

```bash
docker compose up -d mssql
pnpm exec tsx --test --test-name-pattern='SQL Server' ./smoke-test.ts
```

Configuração usada pelo teste:

- Host/porta: `127.0.0.1:1433`
- Usuário/senha: `sa` / `Omni!2024`
- Banco: `omni_test`

### Oracle XE

```bash
docker compose up -d oracle
pnpm exec tsx --test --test-name-pattern='Oracle XE' ./smoke-test.ts
```

Configuração usada pelo teste:

- Host/porta: `127.0.0.1:1521`
- Service: `XEPDB1`
- Usuário/senha: `OMNI` / `omni`

O Oracle XE é o banco mais lento para inicializar. Aguarde o status
`healthy` antes de executar o teste:

```bash
docker compose ps oracle
```

## Teste de integração

O teste de integração valida o fluxo de conexão persistida no backend, além
dos adaptadores. Execute-o com todos os bancos disponíveis:

```bash
docker compose up -d
OMNI_SQL_RUN_INTEGRATION=1 pnpm exec tsx --test ./integration-test.ts
```

## Diagnóstico

Ver status e healthcheck dos bancos:

```bash
docker compose ps
```

Ver logs de um banco:

```bash
docker compose logs postgres
docker compose logs mysql
docker compose logs mssql
docker compose logs oracle
```

Se um banco já tiver sido inicializado com dados incorretos, recrie os
volumes:

```bash
docker compose down -v
docker compose up -d
```

As portas `5432`, `3306`, `1433` e `1521` precisam estar livres no host.

<!--
# Comandos antigos, mantidos apenas como referência:
# node --test --import ./smoke-test.ts não registra os testes; --import trata
# o arquivo como preload. No Node 22, node --test ./smoke-test.ts também não
# carrega TypeScript sem suporte adicional.
#
# Pipeline completo:
# OMNI_SQL_RUN_INTEGRATION=1 node --test --import ./integration-test.ts
#
# Derrubar tudo:
# docker compose down -v
-->

<!--
# O conteúdo abaixo era o quick start original e fica substituído pelos
# comandos acima.

# Aguardar healthcheck (~30-60s para Oracle)
docker compose ps

# Rodar smoke test em todos os bancos
node --test --import ./smoke-test.ts

# Rodar em banco específico
node --test --test-name-pattern=PostgreSQL --import ./smoke-test.ts
node --test --test-name-pattern=MySQL --import ./smoke-test.ts
node --test --test-name-pattern='SQL Server' --import ./smoke-test.ts
node --test --test-name-pattern='Oracle XE' --import ./smoke-test.ts

# Pipeline completo
OMNI_SQL_RUN_INTEGRATION=1 node --test --import ./integration-test.ts

# Derrubar tudo
docker compose down -v
-->

## Schema de teste

Todos os bancos recebem o mesmo schema:

```
customers   (id PK, name, email UNIQUE, city, created_at)
products    (id PK, name, price, category)
orders      (id PK, customer_id FK→customers, order_date, total)
order_items (id PK, order_id FK→orders, product_id FK→products, quantity, unit_price)
```

Mais:
- **View:** `order_summary` (join de orders + customers com count de itens)
- **Função/SP:** `get_customer_total(customer_id)` → retorna o total gasto
- **Índices:** em `orders.customer_id` e `order_items.order_id`

## O que o smoke test valida

O teste importa os adaptadores reais (`@omni-sql/adapters-*`) e exercita a
mesma interface que o backend consome:

| #  | Teste                          | Método do Adaptador         |
|----|--------------------------------|-----------------------------|
| 1  | Conexão                        | `test()`                    |
| 2  | Introspecção completa          | `introspect()`              |
| 3  | Listar schemas disponíveis     | `listAvailableSchemas()`    |
| 4  | Schemas em cache               | `listSchemas()`             |
| 5  | Listar tabelas                 | `listTables()`              |
| 6  | Listar colunas (PK, tipos)     | `listColumns()`             |
| 7  | Colunas com FK                 | `listColumns()`             |
| 8  | Listar funções/SPs             | `listFunctions()`           |
| 9  | SELECT literal                 | `runQuery()`                |
| 10 | COUNT                          | `runQuery()`                |
| 11 | JOIN orders + customers        | `runQuery()`                |
| 12 | SUM + GROUP BY                 | `runQuery()`                |
| 13 | CASE expression                | `runQuery()`                |
| 14 | Subquery correlacionada        | `runQuery()`                |
| 15 | EXPLAIN / EXPLAIN PLAN         | `explain()`                 |
| 16 | Listar índices                 | `listIndexes()`             |
| 17 | Definição de view              | `getDefinition("view")`     |
| 18 | Definição de função/SP         | `getDefinition("function")` |
| 19 | Close gracioso                 | `close()`                   |

## Dependências

Este pacote é parte do workspace pnpm (entrada `docker/*` no
`pnpm-workspace.yaml`). Os adaptadores são resolvidos via `workspace:*`,
então qualquer mudança nos pacotes `packages/adapters-*` é refletida
automaticamente nos testes — sem rebuild necessário.
