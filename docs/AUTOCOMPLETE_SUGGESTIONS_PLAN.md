# Plano — sugestões SQL úteis

Status: concluído

## Objetivo

Priorizar sugestões contextuais executáveis e reduzir ruído de metadados.

## Escopo

- [x] Impedir `ON` e `USING` como aliases implícitos.
- [x] Sugerir relações somente no slot `FROM`/`JOIN` ainda incompleto.
- [x] Adicionar snippets contextuais mínimos:
  - `SELECT * FROM $1`
  - `ORDER BY $1`
  - `GROUP BY $1`
  - `LEFT JOIN $1 ON $2`
  - `INNER JOIN $1 ON $2`
  - transições após relação: `WHERE`, `JOIN`, `GROUP BY`, `HAVING`, `ORDER BY`
- [x] Aplicar relevância do engine como `sortText` no Monaco.
- [x] Não sugerir funções sem prefixo; filtrar funções pelo prefixo digitado.
- [x] Tornar “Todas as colunas” secundária e inserir somente colunas ausentes.
- [x] Citar identificadores somente quando o dialeto exigir.
- [x] Cobrir contextos, ordenação e ausência de ruído com testes focados.

## Fora de escopo

- IA/LLM, parser SQL completo, ranking por histórico, geração de joins por FK,
  catálogo amplo de snippets ou cache/debounce sem medição de latência.

## Critérios de aceite

- `SELECT * FROM users ` sugere transições, não catálogo de relações.
- `sel`, `order`, `group`, `left` e `inner` oferecem snippet contextual.
- `JOIN orders ON ` nunca sugere `ON.id`.
- Funções aparecem somente com prefixo compatível.
- Expansão de colunas não repete colunas já selecionadas.
- Testes engine e typecheck de frontend/backend passam.
