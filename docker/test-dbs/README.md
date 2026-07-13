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

```bash
cd docker/test-dbs

# Instalar dependências (requer pnpm no root do monorepo)
pnpm install

# Subir todos os bancos
docker compose up -d

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
```

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
