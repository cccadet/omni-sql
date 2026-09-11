# Plano de cobertura de testes

## Estado atual

- Frontend: 56,22% linhas, 52,54% statements, 46,85% branches, 45,33% funções.
- Backend: 81,37% linhas, 73,85% branches, 75,21% funções.
- Frontend: `env -u NODE_OPTIONS pnpm --filter desktop test:coverage`.
- Backend: `env -u NODE_OPTIONS pnpm --filter @omni-sql/backend coverage`.

Não comparar percentuais entre frontend e backend: providers e escopos são diferentes.

## Feito

- Exportação CSV no WebView: clique no link anexado ao DOM e revogação atrasada do Blob URL.
- Execução de query: instrução atual/todas, variáveis, limite, erro e diagnóstico.
- Conexões: criar, testar, salvar, falhar/tentar novamente e restaurar conexão listada.
- Cobertura V8 do Vitest e cobertura nativa do `node:test` configuradas.

## Próximas prioridades

### 3. Resultados

- Paginação, filtro global e ordenação.
- Exportar CSV com filtro/ordenação e valores serializados.
- Plano de execução e abas Dados/Mensagens/Plano.
- Edição inline: tabela com PK, sem PK, aplicar, descartar e erro de atualização.

### 4. Editor e sessão

- Autocomplete: contexto, CTE e falha do backend.
- Formatação e atalhos de executar/salvar/formatar.
- Criar, fechar e restaurar abas; histórico de queries.

### 5. Arquivos

- Abrir e salvar SQL pelo diálogo Tauri.
- Cancelamento e erro de I/O sem perder conteúdo da aba.

### 6. Backend RPC

- Métodos ainda sem caminho de falha: conexões, metadata, completion, explain, update e histórico.
- Persistência e reidratação de conexões em reinício.
- Limites, validação e mensagens de erro em todas fronteiras RPC.

### 7. Adaptadores reais

- Integrações opt-in PostgreSQL, MySQL/MariaDB, SQL Server e Oracle.
- Executar query, introspecção, EXPLAIN, timeout e mapeamento de tipos por dialeto.
- Rodar apenas com `OMNI_SQL_RUN_INTEGRATION=1` e bancos de teste disponíveis.

## Critério de avanço

Cobrir fluxo de maior risco antes de perseguir número. Meta intermediária: frontend >= 70% linhas, mantendo testes de fronteiras e falhas. Não adicionar thresholds bloqueantes antes de estabilizar suites e integrações.
