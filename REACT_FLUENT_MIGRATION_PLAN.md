# Plano de Migração — Frontend React + Fluent UI React v9

> **Status:** Planejado — implementação não iniciada.
> **Criado em:** 2026-07-16
> **Última atualização:** 2026-07-16

---

## 1. Resumo das decisões

Após avaliar Material Design 3, Fluent 2 e alternativas Svelte-native, optou-se por:

- **Migrar o frontend de Svelte 5 para React 18/19.**
- **Adotar Fluent UI React v9** como design system oficial.
- **Manter o Tauri (Rust)** como shell desktop.
- **Manter o backend Node.js** e o protocolo JSON-RPC sobre HTTP.
- **Manter o Monaco Editor**, substituindo apenas o wrapper para React (`@monaco-editor/react`).
- Executar a migração **de uma vez só**, em uma branch dedicada.

### Por que React + Fluent UI React v9?

| Critério | Avaliação |
|---|---|
| **Profissional/enterprise** | Visual adequado para IDE SQL (Microsoft 365, Outlook, Teams). |
| **Maturidade** | v9 é a versão estável atual, ativamente mantida pela Microsoft. |
| **Componentes ricos** | DataGrid, Tree, Drawer, Dialog, CommandBar, Tabs — todos presentes. |
| **Temas claro/escuro** | Suporte nativo via `FluentProvider` + temas. |
| **Acessibilidade** | A11y e navegação por teclado já resolvidas. |
| **Longevidade** | Microsoft mantém Fluent UI há anos (evolução do Office UI Fabric). |

---

## 2. Stack alvo

| Camada | Atual | Futuro |
|---|---|---|
| Shell desktop | Tauri (Rust) | **Tauri (Rust)** — mantido |
| Frontend | Svelte 5 + Vite | **React 18/19 + TypeScript + Vite** |
| Design system | HTML/Svelte custom | **Fluent UI React v9** |
| Editor SQL | Monaco (wrapper Svelte) | **Monaco (`@monaco-editor/react`)** |
| Ícones | Lucide | **Fluent Icons (`@fluentui/react-icons`)** |
| Estado global | Svelte runes | React hooks + Context / Zustand (a decidir) |
| Comunicação backend | HTTP JSON-RPC | **HTTP JSON-RPC** — mantido |
| Backend | Node.js TypeScript | **Node.js TypeScript** — mantido |
| Testes | Node `--test` no backend | Manter backend; adicionar React Testing Library no frontend |

---

## 3. Arquitetura preservada

```
┌─────────────────────────────────────────┐
│  Tauri Shell (Rust)                     │
│  ├─ spawna backend Node                 │
│  └─ carrega frontend web                │
└─────────────────────────────────────────┘
                   │
┌─────────────────────────────────────────┐
│  Frontend (React + Fluent UI)           │
│  ├─ App.tsx                             │
│  ├─ Toolbar                             │
│  ├─ Sidebar (Tree)                      │
│  ├─ TabBar                              │
│  ├─ Editor (Monaco)                     │
│  ├─ ResultsGrid (DataGrid)              │
│  ├─ StatusBar                           │
│  ├─ ConnectionDialog                    │
│  ├─ FormatSettings                      │
│  └─ HistoryPanel                        │
└─────────────────────────────────────────┘
                   │ HTTP JSON-RPC :41920
┌─────────────────────────────────────────┐
│  Backend Node.js                        │
│  ├─ connection.*                        │
│  ├─ query.*                             │
│  ├─ metadata.*                          │
│  ├─ completion.*                        │
│  └─ row.*                               │
└─────────────────────────────────────────┘
```

---

## 4. Estrutura de diretórios proposta

```
apps/desktop/
├── src-tauri/              # Tauri shell (mantido)
├── src/                    # Frontend React
│   ├── main.tsx            # Entry point
│   ├── App.tsx             # Layout raiz + FluentProvider
│   ├── theme.ts            # Configuração de temas claro/escuro
│   ├── lib/
│   │   ├── backend.ts      # Cliente JSON-RPC
│   │   ├── monaco/         # Configuração e tema do Monaco
│   │   ├── file-io.ts      # I/O de arquivos SQL
│   │   ├── sql-statements.ts
│   │   ├── sql-variables.ts
│   │   └── format-sql.ts
│   ├── components/
│   │   ├── Toolbar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── TabBar.tsx
│   │   ├── Editor.tsx
│   │   ├── ResultsGrid.tsx
│   │   ├── StatusBar.tsx
│   │   ├── ConnectionDialog.tsx
│   │   ├── FormatSettings.tsx
│   │   ├── HistoryPanel.tsx
│   │   └── SidecarStatus.tsx
│   └── hooks/
│       ├── useConnections.ts
│       ├── useSession.ts
│       └── useTheme.ts
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

> **Nota:** os SVGs de dialeto (`DialectIcon`) podem ser mantidos como componentes React ou substituídos por ícones Fluent quando disponíveis.

---

## 5. Fases de execução

### Fase 0 — Setup do projeto React (estimativa: 1–2 dias) ✅

- [x] Criar branch `feat/react-fluent-migration`.
- [x] Remover dependências Svelte do `apps/desktop/package.json`.
- [x] Adicionar dependências React + Fluent UI:
  - `react`, `react-dom`, `@types/react`, `@types/react-dom`
  - `@fluentui/react-components`
  - `@fluentui/react-icons`
  - `@fluentui/react-hooks` (se necessário)
- [x] Reconfigurar Vite para React (`@vitejs/plugin-react`).
- [x] Reconfigurar ESLint/TypeScript para React.
- [x] Criar `main.tsx` e `App.tsx` mínimos.
- [x] Validar build: `pnpm -r typecheck` e `pnpm -r lint`.

### Fase 1 — Fundação de tema e layout (estimativa: 2–3 dias) ✅

- [x] Configurar `FluentProvider` com `webLightTheme` e `webDarkTheme`.
- [x] Criar toggle de tema claro/escuro + persistência (`localStorage`).
- [x] Criar layout base em grid CSS equivalente ao atual.
- [x] Criar componentes vazios/placeholder:
  - `Toolbar`, `Sidebar`, `TabBar`, `Editor`, `ResultsGrid`, `StatusBar`.
- [x] Validar visual nos dois temas.

### Fase 2 — Monaco Editor + backend JSON-RPC (estimativa: 2–3 dias) ✅

- [x] Integrar `@monaco-editor/react`.
- [x] Configurar tema do Monaco (`vs` no claro, `vs-dark` no escuro).
- [x] Portar configuração SQL do Monaco (tokenização, autocomplete, formatação).
- [x] Reconectar cliente JSON-RPC (`lib/backend.ts`).
- [x] Testar chamada `connection.list` no boot.

### Fase 3 — Componentes principais (estimativa: 5–8 dias) ✅

- [x] `Toolbar`: conexões, execução, limite, salvar/abrir, formatação.
- [x] `Sidebar`: tree de schemas/tabelas/colunas com Fluent `Tree`.
- [x] `TabBar`: abas de query com `Tabs`.
- [x] `StatusBar`: informações de conexão, resultado e cursor.
- [x] `ConnectionDialog`: formulário por dialecto com Fluent form controls.
- [x] `FormatSettings`: configurações do formatador SQL.
- [x] `HistoryPanel`: drawer lateral com histórico de queries.

### Fase 4 — ResultsGrid e funcionalidades avançadas (estimativa: 4–6 dias) ✅

- [x] Implementar `ResultsGrid` com tabela avançada (componentes base Fluent; DataGrid dinâmico evitado por API instável).
- [x] Ordenação, filtro global e paginação client-side.
- [x] Edição inline de células via PK (via `query.analyzeEditability` + `row.update`).
- [x] Sub-abas: Dados / Mensagens / Plano.
- [x] Indicador de "mais linhas disponíveis".
- [x] Painel de EXPLAIN via `query.explain`.

### Fase 5 — Editor avançado e execução (estimativa: 3–5 dias) ✅

- [x] Reimplementar split de statements SQL.
- [x] Reimplementar variáveis `:nome` com modal.
- [x] Reimplementar execução de instrução atual vs. todas.
- [x] Reimplementar atalhos de teclado (Ctrl+Enter, Ctrl+S, etc.).
- [x] Reimplementar autocomplete via backend.
- [x] Reimplementar formatação SQL com `sql-formatter`.

### Fase 6 — Persistência, sessão e polimento (estimativa: 2–3 dias)

- [ ] Restaurar persistência de sessão (`localStorage`).
- [ ] Restaurar histórico de queries.
- [ ] Persistir preferências de tema.
- [ ] Ajustes de acessibilidade e focus.
- [ ] Testes visuais nos dois temas.

### Fase 7 — Testes e integração (estimativa: 2–3 dias)

- [ ] Smoke test E2E via JSON-RPC (reutilizar `packages/backend/test/smoke.test.ts`).
- [ ] Adicionar testes de componentes React básicos (React Testing Library).
- [ ] Verificar `pnpm verify` completo.
- [ ] Atualizar `AGENTS.md` e `README.md`.
- [ ] Revisão de PR e merge.

**Estimativa total: 2–4 semanas de trabalho focado.**

---

## 6. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Reescrita do frontend levar mais tempo que o previsto | Alto | Fazer spike inicial com layout + Monaco + uma chamada backend antes de comprometer todas as funcionalidades. |
| Componentes Fluent não cobrirem 100% dos casos da IDE | Médio | Usar componentes base e customizar quando necessário; manter tabela de resultados altamente customizada se DataGrid não atender. |
| Monaco perder funcionalidades customizadas | Médio | Migrar configuração gradualmente; testar autocomplete, temas e formatação. |
| Performance com temas e re-renderizações | Médio | Usar `React.memo`, `useMemo`, `useCallback` e Contextos bem delimitados. |
| Perda de estado durante a migração | Baixo | Manter mesmo formato de `localStorage` ou migrar chaves. |

---

## 7. Notas de atualização

Use esta seção para registrar progresso, decisões e mudanças ao longo da migração.

### 2026-07-16 — Fase 5 concluída
- `Editor.tsx` e `App.tsx` ganharam execução avançada:
  - `splitStatements` para dividir SQL em instruções (`;` respeitando strings, comentários e dollar-quoting).
  - `Ctrl+Enter` executa a instrução sob o cursor (ou seleção); `Ctrl+Shift+Enter` executa todas as instruções.
  - Quando há múltiplas instruções e nenhuma seleção, surge modal de escolha "instrução atual" / "todas".
  - Variáveis `:nome` são extraídas (`sql-variables.ts`) e um modal pede os valores antes da execução; substituição vira literais de texto SQL.
  - `Ctrl+S` salva a aba ativa; `Ctrl+Alt+L` formata o documento via `sql-formatter`.
  - Autocomplete do Monaco já integrado a `completion.get` do backend.
- Criado `VariablesDialog.tsx` para input dos binds.
- `pnpm -r typecheck`, `pnpm -r lint` e `pnpm --filter desktop build` passam.

### 2026-07-16 — Fase 4 concluída
- `ResultsGrid` reescrito com funcionalidades avançadas:
  - Ordenação por coluna, filtro global de texto e paginação client-side (100 linhas/página).
  - Exportação para CSV do resultado filtrado/ordenado.
  - Edição inline de células quando a query for um SELECT simples editável (`query.analyzeEditability`) e a coluna mapear para uma coluna real; gravação via `row.update` usando PK.
  - Sub-abas: Dados, Mensagens (linhas afetadas/retornadas, tempo, erro) e Plano (quando disponível).
- `Toolbar` ganhou botão "EXPLAIN" que chama `query.explain` e exibe o plano textual na aba Plano.
- `App.tsx` integra análise de editabilidade após execução com sucesso e mantém estado do plano por execução.
- `pnpm -r typecheck`, `pnpm -r lint` e `pnpm --filter desktop build` passam.

### 2026-07-16 — Fase 3 concluída
- Componentes principais reescritos em React + Fluent UI:
  - `Toolbar` com seleção de conexão, execução, limite, salvar/abrir e toggle de sidebar/histórico.
  - `Sidebar` com árvore customizada de schemas → tabelas/views/funções e busca.
  - `TabBar` com indicador de dirty, ícone de dialecto e rename por duplo-clique.
  - `StatusBar` com conexão, resultado e posição do cursor.
  - `ConnectionDialog` com formulário por dialecto, teste de conexão e seleção de schemas.
  - `FormatSettings` com preview ao vivo do `sql-formatter`.
  - `HistoryPanel` drawer com busca e filtros por conexão/status.
- `App.tsx` integra todos os componentes, gerencia estado de sessão, conexões, histórico e já executa queries via `query.run`.
- `pnpm -r typecheck`, `pnpm -r lint` e `pnpm --filter desktop build` passam.

### 2026-07-16 — Fase 2 concluída
- `Editor.tsx` reescrito com `@monaco-editor/react`, usando `onMount` para registrar a linguagem customizada `sql-omni`, provedores de formatação (via `sql-formatter`) e autocomplete (placeholder para backend `completion.get`).
- Criado `src/lib/monaco-config.ts` portando a configuração do Monaco do Svelte anterior.
- Tema do Monaco sincronizado com tema Fluent (`vs` claro / `vs-dark` escuro); atalho de formatação (`Ctrl+Alt+L`) configurado.
- `useConnections` agora chama realmente `backend.call("connection.list", {})` no boot; testado via cURL contra backend na porta 41920.
- `vite.config.ts` ajustado com `manualChunks` para separar Monaco e Fluent em chunks próprios e `chunkSizeWarningLimit` para evitar warnings de bundle.
- `pnpm -r typecheck`, `pnpm -r lint` e `pnpm --filter desktop build` passam.

### 2026-07-16 — Fase 1 concluída
- Criados componentes placeholder em `src/components/` (`Toolbar`, `Sidebar`, `TabBar`, `Editor`, `ResultsGrid`, `StatusBar`) usando Fluent UI React v9.
- Criados hooks iniciais em `src/hooks/` (`useTheme`, `useSession`, `useConnections`).
- `App.tsx` replicou o layout em grid CSS do frontend Svelte anterior (toolbar, tab bar, sidebar, editor, results, status bar).
- Adicionado script `build` no `apps/desktop/package.json` (`vite build`); build de produção passa.
- `pnpm -r typecheck`, `pnpm -r lint` e `pnpm --filter desktop build` passam.

### 2026-07-16 — Fase 0 concluída
- Criada branch `feat/react-fluent-migration` e substituído o frontend Svelte pelo setup React + Fluent UI React v9.
- `apps/desktop/package.json` agora usa `react`, `react-dom`, `@fluentui/react-components`, `@fluentui/react-icons` e `@monaco-editor/react`.
- Vite reconfigurado com `@vitejs/plugin-react`; TypeScript com `jsx: "react-jsx"`; ESLint com `eslint-plugin-react-hooks` (também adicionado como devDep no root para todos os workspaces compartilharem o config).
- Criados `src/main.tsx`, `src/App.tsx` e `src/theme.ts` com `FluentProvider`, toggle claro/escuro e persistência em `localStorage`.
- Componentes Svelte removidos de `src/` (arquivos utilitários TypeScript puros mantidos em `src/lib/`).
- `pnpm -r typecheck` e `pnpm -r lint` passam. `pnpm -r test` passa em todos os workspaces exceto `docker/test-dbs`, que requer bancos de dados Docker rodando.

---

## 8. Links de referência

- Fluent UI React v9: https://react.fluentui.dev/
- Fluent UI React Components: https://www.npmjs.com/package/@fluentui/react-components
- Monaco Editor for React: https://www.npmjs.com/package/@monaco-editor/react
- Tauri + React guide: https://tauri.app/start/frontend/vite/#react
- Projeto original Svelte: `apps/desktop/src/` (referência durante a migração)
