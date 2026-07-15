A lista do ChatGPT é boa como checklist, mas parte dela já está feita no omni-sql — e a ordem de implementação pode ser ajustada com base no que o código mostra hoje.

O que já existe (e a lista não percebeu)
Olhando o código e a screenshot:

Sugestão	Estado atual
5. Reorganizar barra superior
Feito — Toolbar.svelte já agrupa Conexão, Fonte, Execução, Limite e Editor com labels e divisores
6. Destaque ao Executar
Parcialmente feito — botão azul com ícone Play, único CTA primário da toolbar
7. Cabeçalho fixo no grid
Feito — position: sticky em ResultsGrid.svelte
10. Barra de info da query
Feito — "8 linha(s) · 5 coluna(s) · 5ms" + badge editável
3. Ícones distintos na árvore
Parcial — schema/tabela/view/função já têm Lucide icons; faltam triggers, procedures, sequences etc.
4. PK/FK e tipos
Feito (F1) — ícones KeyRound/Link2 + badges "PK"/"FK" como chips de texto com cor;
typeIcon() extraído para `type-icons.svelte.ts` compartilhado entre Sidebar e ResultsGrid.
Ou seja: não reinvente toolbar nem info bar — refine o que já está lá.

O que realmente falta e vale a pena
Alto impacto, baixo risco (só frontend)
Busca na árvore ✅ (F1) — input no header + $derived filtrando groups + auto-expand dos nós que batem.
Filtro casa com tabelas, views, funções e colunas; highlight azul nas colunas que batem.

Grid: seleção de linha + sort client-side — sticky header já existe; faltam hover/seleção visível e clique no cabeçalho para ordenar. Sort é 100% client-side sobre o resultset já carregado — sem backend.

Badges PK/FK/tipo na árvore ✅ (F1) — typeIcon() extraído para `type-icons.svelte.ts` compartilhado; chips discretos "PK" (dourado) e "FK" (azul) além dos ícones atuais.

Conexão ativa mais evidente — hoje fica num <select> genérico + emoji de dialeto + 🟢 de sync de metadados. Falta um chip de status (“Test Oracle XE · Oracle · conectado”) — idealmente no header da sidebar, não só na toolbar.

Médio impacto, esforço moderado
Barra de status inferior — não existe componente dedicado. Mostraria: conexão, dialeto, encoding (quando disponível), linha/coluna do cursor no editor, contagem de resultados. Hoje isso está espalhado (busyMsg, SidecarStatus, header do grid).

Histórico com busca — HistoryPanel.svelte lista entradas mas sem filtro por texto/conexão/sucesso.

Filtros por coluna no grid — útil, mas secundário em relação a sort + seleção. Começaria com filtro client-side simples (input por coluna).

Alto impacto, mais esforço (backend + UI)
Abas de resultados (Dados / Mensagens / Plano) — hoje é um painel único. O Adapter.explain() já existe nos adaptadores, mas não há RPC query.explain no protocolo — isso está no roadmap (F5/F9 do PROJECT_PLAN.md). É a feature mais valiosa da lista média, mas não é “só CSS”.
Baixa prioridade (ou deferir)
Breadcrumbs na árvore — pouco valor num tree view colapsável; a busca resolve melhor a navegação.
Minimap / bookmarks no editor — Monaco suporta nativamente (minimap.enabled, glyphMargin); é config, não feature nova.
Animações/hover — polish final, depois das features funcionais.
Procedures/triggers/sequences na árvore — depende de introspection no backend, não só ícones.
Ordem que eu recomendaria (diferente da do ChatGPT)
Fase 1: busca na árvore + badges PK/FK ✅ — Implementado: busca com filtro + auto-expand + badges PK/FK + typeIcon compartilhado
Fase 2: grid sort + seleção de linha ✅
Fase 3: chip de conexão + status bar
Fase 4: histórico com busca
Fase 5: abas de resultados + RPC explain
Fase 6: polish visual + filtros de coluna
Por quê essa ordem:

Busca na árvore primeiro — concordo com o ChatGPT; é o gap mais gritante na screenshot (muitas tabelas, zero filtro).
Pular reorganização da toolbar — já está feita; só ajustaria visual se sobrar tempo (ex.: Executar um pouco maior ou separado visualmente do grupo Limite).
Grid antes da status bar — você usa o grid o tempo todo; sort + highlight mudam o dia a dia mais que um footer informativo.
Abas de resultados por último entre as médias — exige protocolo backend; as outras fases entregam valor imediato sem tocar em packages/backend.
Filtros de coluna como opcional tardio — nice-to-have; sort resolve 80% do caso.
Resumo da opinião
A lista do ChatGPT é sólida como visão, mas trata como "a fazer" coisas que vocês já implementaram (toolbar agrupada, cabeçalho fixo, info bar, ícones básicos). Eu focaria em:

Busca na árvore ✅
Sort + seleção no grid
Badges PK/FK reutilizando lógica do grid ✅
Status bar + chip de conexão
Abas de resultados (com RPC explain)
Polish (histórico, filtros, animações, Monaco minimap)
Se quiser, no próximo passo monto um plano de implementação detalhado para a Fase 1 (busca + badges), que é onde o ROI é maior com o menor diff.

---

## Implementação Fase 1 ✅ (2026-07-14)

**Arquivos alterados/criados:**

| Arquivo | Mudança |
|---|---|
| `apps/desktop/src/lib/type-icons.svelte.ts` | **Novo** — util compartilhado `typeIcon(dataType)` com imports Lucide (Hash, Calendar, ToggleLeft, etc.) |
| `apps/desktop/src/lib/Sidebar.svelte` | Busca + badges + highlight + auto-expand |
| `apps/desktop/src/lib/ResultsGrid.svelte` | Refatorado para importar `typeIcon()` do util compartilhado |

**Funcionalidades entregues:**

1. **Busca na árvore**: input "Buscar tabelas, colunas..." filtra em tempo real tabelas/views/funções/colunas. Auto-expande schemas e nós quando busca está ativa. Colunas com match ficam com highlight azul claro.

2. **Badges PK/FK**: chips de texto "PK" (dourado `#d4a72c`) e "FK" (azul `#6ea8fe`) ao lado dos ícones KeyRound/Link2 existentes.

3. **Type icons compartilhados**: `typeIcon()` extraído de ResultsGrid para `type-icons.svelte.ts` — reutilizado entre Sidebar e ResultsGrid (Hash, Calendar, ToggleLeft, Braces, Fingerprint, Binary, CircleHelp, CaseSensitive).

**Arquivos:** `.svelte.ts` (não `.ts`) porque imports de componentes Svelte precisam do processamento do compilador Svelte via Vite.

---

## Implementação Fase 2 ✅ (2026-07-15)

**Arquivo alterado:**

| Arquivo | Mudança |
|---|---|
| `apps/desktop/src/lib/ResultsGrid.svelte` | Sort client-side + seleção/highlight de linha + navegação por teclado |

**Funcionalidades entregues:**

1. **Sort client-side no grid**: clique no cabeçalho alterna `asc` → `desc` → sem sort. Ícone ▲/▼ indica direção ativa, coluna sorted ganha destaque no header. Comparação numérica, bigint, Date e string (`localeCompare` com `numeric: true`); `NULL` sempre vai para o final.

2. **Seleção de linha**: clique em qualquer célula seleciona a linha (fundo azul). Setas ↑/↓ navegam entre linhas quando o grid está focado.

3. **Compatível com edição inline**: sort não quebra `row.update` — `displayRows` preserva o `originalIndex` e toda a edição (startEdit, commitEdit, errorFor, savingCell) continua apontando para `result.rows[originalIndex]`.

4. **Reset automático**: nova query limpa sort e seleção.

**Nota:** `pnpm verify` passa em typecheck e lint; os testes de backend falham por problema preexistente no registry (`jdbc-generic` / concorrência entre testes de smoke), não relacionado a esta mudança de UI.

---

## Implementação Fase 3 ✅ (2026-07-15)

**Arquivos alterados/criados:**

| Arquivo | Mudança |
|---|---|
| `apps/desktop/src/lib/StatusBar.svelte` | **Novo** — footer com conexão ativa, dialeto, contagem de resultados, tempo de execução e posição do cursor |
| `apps/desktop/src/lib/Sidebar.svelte` | Chip de conexão ativa no header (ícone do dialeto + label + status de sincronização) |
| `apps/desktop/src/lib/Editor.svelte` | Prop `onCursorChange` emitindo `line/column` a cada movimento do cursor |
| `apps/desktop/src/App.svelte` | Integra `StatusBar` no grid, propaga `activeConnection`, `cursorPosition` e resultado da aba ativa |

**Funcionalidades entregues:**

1. **Chip de conexão na sidebar**: o header "Objetos" foi substituído por um chip `DialectIcon + label + badge` quando há conexão ativa. O badge mostra `conectado` (verde) quando os metadados já foram sincronizados e `não sincronizado` (neutro) quando ainda não. Sem conexão, o header volta a mostrar "Objetos".

2. **Status bar inferior**: footer azul (`#007acc`) mostrando:
   - Conexão ativa: ícone do dialeto, nome, badge de status e rótulo do dialeto (PostgreSQL, MySQL, etc.).
   - Mensagem de atividade (`busyMsg`) quando há introspect/execução em andamento.
   - Contagem de resultados: `N linha(s) · M coluna(s)` + tempo `ms`.
   - Posição do cursor no editor: `Ln X, Col Y`.

3. **Posição do cursor viva**: `Editor.svelte` escuta `onDidChangeCursorPosition` do Monaco e repassa `{ line, column }` para `App.svelte`, que alimenta a status bar.

4. **Layout sem quebras**: `App.svelte` ganhou uma nova linha de grid (`grid-template-rows: auto auto 1fr 1fr auto`) e a status bar ocupa a linha 5, mantendo sidebar, editor e grid de resultados intactos.

**Nota:** `pnpm verify` passa em typecheck e lint. Os testes de backend continuam falhando pelo mesmo problema preexistente no registry `jdbc-generic` / concorrência entre testes de smoke, não relacionado a esta mudança de UI.

---

## Implementação Fase 4 ✅ (2026-07-15)

**Arquivo alterado:**

| Arquivo | Mudança |
|---|---|
| `apps/desktop/src/lib/HistoryPanel.svelte` | Busca + filtros por conexão/status, contador de resultados e highlight de matches |

**Funcionalidades entregues:**

1. **Busca textual**: input "Buscar no histórico..." filtra em tempo real por SQL, nome da conexão e dialeto. O primeiro trecho da query é exibido com highlight azul (`#264f78`) nos trechos que batem.

2. **Filtro por conexão**: dropdown com "Todas as conexões" + lista deduplicada das conexões presentes no histórico.

3. **Filtro por status**: chips "Todas" / "Sucesso" / "Erro" — o chip ativo ganha cor de destaque (azul para sucesso, vermelho para erro).

4. **Contador de resultados**: label `N resultado(s)` acima da lista filtrada.

5. **Estado vazio amigável**: quando há histórico mas nenhum filtro bate, mostra "Nenhuma entrada corresponde aos filtros." com link para limpar todos os filtros de uma vez.

6. **Painel ligeiramente maior**: largura aumentada de `340px` para `380px` para acomodar a barra de filtros sem truncar labels.

**Nota:** `pnpm -r typecheck` e `pnpm -r lint` passam. Nenhum contrato backend ou prop de `App.svelte` foi alterado — a feature é 100% client-side no componente de histórico.
