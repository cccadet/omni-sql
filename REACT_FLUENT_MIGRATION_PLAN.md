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

### Fase 1 — Fundação de tema e layout (estimativa: 2–3 dias)

- [ ] Configurar `FluentProvider` com `webLightTheme` e `webDarkTheme`.
- [ ] Criar toggle de tema claro/escuro + persistência (`localStorage`).
- [ ] Criar layout base em grid CSS equivalente ao atual.
- [ ] Criar componentes vazios/placeholder:
  - `Toolbar`, `Sidebar`, `TabBar`, `Editor`, `ResultsGrid`, `StatusBar`.
- [ ] Validar visual nos dois temas.

### Fase 2 — Monaco Editor + backend JSON-RPC (estimativa: 2–3 dias)

- [ ] Integrar `@monaco-editor/react`.
- [ ] Configurar tema do Monaco (`vs` no claro, `vs-dark` no escuro).
- [ ] Portar configuração SQL do Monaco (tokenização, autocomplete, formatação).
- [ ] Reconectar cliente JSON-RPC (`lib/backend.ts`).
- [ ] Testar chamada `connection.list` no boot.

### Fase 3 — Componentes principais (estimativa: 5–8 dias)

- [ ] `Toolbar`: conexões, execução, limite, salvar/abrir, formatação.
- [ ] `Sidebar`: tree de schemas/tabelas/colunas com Fluent `Tree`.
- [ ] `TabBar`: abas de query com `Tabs`.
- [ ] `StatusBar`: informações de conexão, resultado e cursor.
- [ ] `ConnectionDialog`: formulário por dialecto com Fluent form controls.
- [ ] `FormatSettings`: configurações do formatador SQL.
- [ ] `HistoryPanel`: drawer lateral com histórico de queries.

### Fase 4 — ResultsGrid e funcionalidades avançadas (estimativa: 4–6 dias)

- [ ] Implementar `ResultsGrid` com Fluent UI `DataGrid`.
- [ ] Ordenação, filtro por coluna, seleção de linha.
- [ ] Edição inline de células via PK.
- [ ] Sub-abas: Dados / Mensagens / Plano.
- [ ] Botão "Carregar mais linhas".
- [ ] Painel de EXPLAIN.

### Fase 5 — Editor avançado e execução (estimativa: 3–5 dias)

- [ ] Reimplementar split de statements SQL.
- [ ] Reimplementar variáveis `:nome` com modal.
- [ ] Reimplementar execução de instrução atual vs. todas.
- [ ] Reimplementar atalhos de teclado (Ctrl+Enter, Ctrl+S, etc.).
- [ ] Reimplementar autocomplete via backend.
- [ ] Reimplementar formatação SQL com `sql-formatter`.

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
