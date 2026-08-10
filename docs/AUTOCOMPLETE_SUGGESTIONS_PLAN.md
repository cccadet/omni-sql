# Plano — sugestões SQL úteis

Status: em andamento

## Objetivo

Priorizar sugestões contextuais executáveis e reduzir ruído de metadados.

## Escopo

- [ ] Impedir `ON` e `USING` como aliases implícitos.
- [ ] Sugerir relações somente no slot `FROM`/`JOIN` ainda incompleto.
- [ ] Adicionar snippets contextuais mínimos:
  - `SELECT * FROM $1`
  - `ORDER BY $1`
  - `GROUP BY $1`
  - `LEFT JOIN $1 ON $2`
  - `INNER JOIN $1 ON $2`
  - transições após relação: `WHERE`, `JOIN`, `GROUP BY`, `HAVING`, `ORDER BY`
- [ ] Aplicar relevância do engine como `sortText` no Monaco.
- [ ] Não sugerir funções sem prefixo; filtrar funções pelo prefixo digitado.
- [ ] Tornar “Todas as colunas” secundária e inserir somente colunas ausentes.
- [ ] Citar identificadores somente quando o dialeto exigir.
- [ ] Cobrir contextos, ordenação e ausência de ruído com testes focados.

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
