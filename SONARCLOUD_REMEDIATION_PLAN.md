# Plano de Remediação SonarCloud

## Objetivo

Fazer o Quality Gate do projeto `cccadet_omni-sql` passar sem reduzir os thresholds, excluir código de produção ou aceitar falsos positivos sem evidência.

## Linha de base

Análise publicada em `2026-08-12T02:44:08Z` (`988c8dcd-cd9a-4325-825b-4c25181694be`):

| Critério do Quality Gate | Atual | Exigido |
|---|---:|---:|
| Reliability rating no código novo | D | A |
| Security rating no código novo | C | A |
| Cobertura no código novo | 35,0% | >=80% |
| Duplicação no código novo | 4,9% | <=3% |
| Security hotspots revisados | 100% | 100% |

Métricas globais: 17.339 LOC, 33,2% de cobertura, 1 bug, 9 vulnerabilidades, 273 code smells e 5,2% de duplicação.

A análise já separa testes de fontes, inclui Kotlin, importa JaCoCo e aceita LCOV TypeScript/Rust. Não alterar esses limites ou voltar a excluir produção para maquiar o resultado.

## Escopo

Inclui:

- corrigir o bug e vulnerabilidades de produção que mantêm reliability/security abaixo de A;
- tornar a geração e importação de cobertura completa, determinística e verificável no CI Node 22 / Java 21 / Rust estável;
- ampliar somente testes que defendam contratos observáveis até >=80% no código novo;
- reduzir duplicação nova por extração de comportamento compartilhado, preservando as interfaces atuais;
- confirmar o Quality Gate no SonarCloud.

Não inclui:

- reduzir os thresholds do Quality Gate;
- excluir arquivos de produção, silenciar regras ou marcar issues como falso positivo sem demonstrar a impossibilidade do impacto;
- perseguir o backlog histórico de smells que não bloqueia código novo, exceto onde o mesmo refactor remove duplicação ou protege um contrato;
- reescrever módulos apenas para aumentar cobertura.

## Fase 0 — tornar a análise reproduzível

### 0.1 Corrigir a execução local de cobertura

**Responsáveis:** `scripts/test-coverage.mjs`, `apps/desktop/vitest.config.ts`, scripts `coverage` dos pacotes.

1. Executar o mesmo runtime do CI: Node 22, Java 21 e Rust estável com `llvm-tools-preview`/`cargo-llvm-cov`.
2. Fazer `pnpm test:coverage` falhar se qualquer workspace esperado não produzir `coverage/lcov.info`; não aceitar cobertura parcial silenciosamente.
3. Normalizar cada registro `SF:` de LCOV para caminho relativo ao root do monorepo e rejeitar registros que apontem fora do repositório.
4. Gerar e validar estes artefatos antes do scan:
   - `apps/desktop/coverage/lcov.info`;
   - um `coverage/lcov.info` para cada pacote TypeScript com testes;
   - `services/jvm-sidecar/build/reports/jacoco/test/jacocoTestReport.xml`;
   - `apps/desktop/src-tauri/coverage/lcov.info`.
5. Ajustar a configuração de cobertura do Vitest apenas se a execução total sob Node 22 falhar. Reproduzir com o menor conjunto de workers necessário; não mascarar testes com timeouts maiores.
6. Atualizar `sonar-project.properties` para listar somente relatórios que o passo anterior garante produzir.


**Estado:** cobertura local reproduzível e relatórios LCOV/JaCoCo disponíveis. O scan de `2026-08-12` ainda apontou `apps/desktop/src/monaco-env.d.ts`; o exclude de declarations foi corrigido e aguarda o próximo relatório completo.
**Aceite:** um runner limpo reproduz `pnpm test:coverage`, todos os relatórios existem e o scanner não registra `No LCOV files were found` nem `Could not resolve ... file paths`.

### 0.2 Manter CI como fonte de verdade

**Responsável:** `.github/workflows/ci.yml`.

1. Rodar a geração de cobertura antes do scanner, com Node 22, Java 21 e Rust estável já instalados.
2. Manter `-Dsonar.qualitygate.wait=true`; o job deve falhar quando o gate falhar.
3. Manter `SONAR_TOKEN` apenas como secret do GitHub; não imprimir nem persistir o valor.
4. Configurar o check `SonarCloud analysis` como obrigatório na proteção da branch padrão.

**Aceite:** um pull request interno exibe o check SonarCloud e não pode fazer merge com Quality Gate vermelho.

## Fase 1 — corrigir Reliability e Security

### 1.1 Bug crítico de ordenação

**Issue:** `typescript:S2871` em `packages/backend/src/mcp-handlers.ts:79`.

1. Trocar `Object.keys(body).sort()` por um comparador explícito com `localeCompare`, preservando a validação de chaves exatas.
2. Acrescentar caso de teste em `mcp-handlers.test.ts` para a ordem esperada e para chaves Unicode/case-sensitive relevantes à API.

**Aceite:** a issue desaparece e `new_reliability_rating` passa para A.

### 1.2 Vulnerabilidades de geração de identificador

**Issues:** `typescript:S2245` em `apps/desktop/src/App.tsx`, `apps/desktop/src/components/ConnectionDialog.tsx`, `apps/desktop/src/hooks/useSession.ts` e `packages/adapters-pg/src/introspection.ts`.

1. Classificar cada uso: capacidade/autorização, chave persistida, identidade local ou amostragem não-secreta.
2. Para identificadores que podem cruzar fronteira de confiança, usar Web Crypto (`crypto.randomUUID` ou `getRandomValues`) no frontend e `node:crypto` no backend.
3. Para amostragem sem requisito de segredo, manter a API somente após registrar a justificativa técnica na issue SonarCloud; não trocar algoritmos sem necessidade funcional.
4. Cobrir unicidade/formato e preservar a compatibilidade dos IDs persistidos em `localStorage`.

**Aceite:** nenhum ID usado como capacidade, chave ou correlação externa usa `Math.random`; as issues restantes possuem justificativa de falso positivo revisada no SonarCloud ou foram removidas por alteração de código.

### 1.3 Persistência de histórico SQL

**Issue:** `tssecurity:S8475` em `apps/desktop/src/App.tsx:74`.

1. Rastrear o valor que chega a `saveHistory` a partir de `backend.call` e separar SQL do usuário de dados retornados pelo backend.
2. Persistir somente a forma já validada de `HistoryEntry`: `sql` string limitada e `ok` boolean opcional.
3. Validar o conteúdo lido de `localStorage` no carregamento, descartando registros inválidos e preservando histórico válido antigo.
4. Adicionar testes para resposta de backend malformada, payload de storage malformado e histórico válido.

**Aceite:** o fluxo de taint não alcança `localStorage` com objeto remoto não validado; o comportamento de restauração do histórico permanece compatível.

### 1.4 Revisar o falso positivo CORS

**Issues:** `tssecurity:S8348` em `packages/backend/src/index.ts`.

1. Demonstrar por teste que Origem só é refletida depois de `ALLOWED_ORIGINS.has(origin)` e que wildcard é recusado no boot.
2. Se o SonarCloud continuar sem reconhecer a guarda, manter a allowlist e marcar a issue como falso positivo com o teste e os links de linha como evidência.
3. Não substituir a allowlist por reflexão de Origin, regex permissiva ou `*`.

**Aceite:** política CORS continua com allowlist explícita, sem wildcard, e cada issue está removida ou documentadamente marcada como falso positivo.

## Fase 2 — elevar cobertura de código novo para >=80%

### 2.1 Medir antes de adicionar testes

1. Após a Fase 0, abrir o relatório por arquivo do SonarCloud para o período de código novo.
2. Ordenar lacunas por linhas não cobertas e risco: limites de entrada, autenticação, persistência, estado de UI e erros de I/O antes de renderização cosmética.
3. Tratar cobertura como resultado de contratos; não adicionar testes de implementação ou snapshots sem comportamento observável.

### 2.2 Backend e MCP

**Arquivos prioritários:** `packages/backend/src/mcp-handlers.ts`, `mcp-bridge.ts`, `index.ts`, `handlers.ts`, `keyring.ts` e `sidecar-client.ts`.

1. Cobrir entradas inválidas, limites de payload, expiração, cancelamento, listener duplicado, token inválido, Origins permitidas/recusadas e erros de transporte.
2. Isolar os testes que abrem porta ou usam estado global: portas efêmeras, setup/teardown determinístico, sem correr arquivos concorrentes que compartilham token ou bridge.
3. Corrigir a flakiness atual em `packages/backend/test/mcp.test.ts` antes de confiar no relatório de cobertura; a resposta `mcp.ui.respond` deve ser esperada somente depois de confirmar a entrega do request.

**Aceite:** testes do backend passam repetidamente sob Node 22 e a cobertura dos ramos de validação e autorização modificados é >=80%.

### 2.3 Frontend

**Arquivos prioritários:** `App.tsx`, `useSession.ts`, `ConnectionDialog.tsx`, `mcp-ui-bridge.ts`, `Toolbar.tsx`.

1. Testar transições de estado: criar/restaurar tabs, gerar IDs, salvar/carregar histórico, conexão duplicada, cancelamento/fechamento de diálogo e listener MCP.
2. Usar Testing Library e interações de usuário; testar semântica e efeitos visíveis, não detalhes internos de hooks.
3. Garantir que diálogos Fluent tenham teste de foco/escape quando o contrato público depender disso.

**Aceite:** o relatório Vitest LCOV é completo e o código novo desses fluxos tem >=80% de linhas e ramos relevantes cobertos.

### 2.4 Kotlin e Rust

1. Kotlin: ampliar `ScopeResolverTest`, `JdbcConnectionManagerTest` e `QueryEditabilityAnalyzerTest` nos limites de parser, autenticação, timeout e JSON inválido expostos pelo sidecar.
2. Rust: criar testes unitários no módulo `lib.rs` para geração de token, allowlist de env herdada, montagem segura do descriptor MCP e parsing das respostas de health; gerar LCOV com `cargo llvm-cov`.
3. Não testar spawning real de Tauri ou JVM quando uma função pura já contém a regra; usar um smoke test somente para o caminho de integração indispensável.

**Aceite:** JaCoCo e LCOV Rust são importados sem warning e cobrem contratos de segurança alterados.

## Fase 3 — reduzir duplicação no código novo

1. Abrir os blocos duplicados indicados pelo SonarCloud na aba de duplicação do período novo.
2. Extrair apenas comportamento com mesma responsabilidade e mesma semântica; preferir função local/módulo existente a criar framework utilitário.
3. Primeiro alvo: parsing/validação repetidos em handlers MCP/RPC e serialização de erros/respostas, se o relatório confirmar duplicação nesses caminhos.
4. Adicionar teste de equivalência antes da extração quando houver mais de um chamador.

**Aceite:** `new_duplicated_lines_density <=3%`; todos os chamadores usam a implementação única e os testes preservam respostas e status HTTP existentes.

## Progresso em 2026-08-12

- A geração local de relatórios está determinística: `pnpm test:coverage` executa
  26 arquivos/89 testes frontend em worker único, exige LCOV de cada workspace e
  normaliza todos os caminhos `SF:` para o root do monorepo.
- Os artefatos JaCoCo e Rust LCOV foram regenerados com sucesso; `cargo llvm-cov`
  executou 17 testes em `apps/desktop/src-tauri`.
- Foram adicionados contratos observáveis para IDs e histórico persistido, CORS,
  MCP, helpers nativos de arquivo, ícones de tipo, freshness de metadata, tema,
  abas e painel de histórico. A cobertura global local do frontend passou de
  57,9% para 60,8% de statements (89 testes).
- O scanner anterior falhou durante a análise TypeScript com bridge Node sem
  resposta. `sonar.javascript.node.maxspace=4096` foi configurado para o
  subprocesso do analisador; a publicação e o Quality Gate continuam pendentes
  de uma análise completa no SonarCloud.

## Fase 4 — fechamento

1. Executar, no ambiente equivalente ao CI:
   - `pnpm test:coverage`;
   - `pnpm verify`;
   - `./services/jvm-sidecar/gradlew test jacocoTestReport`;
   - `cargo llvm-cov --manifest-path apps/desktop/src-tauri/Cargo.toml --lcov --output-path apps/desktop/src-tauri/coverage/lcov.info`;
   - scanner SonarCloud com `-Dsonar.qualitygate.wait=true`.
2. Confirmar no SonarCloud que todas as condições do gate estão verdes.
3. Conferir manualmente que não restaram avisos de relatório ausente, caminho LCOV não resolvido ou blame ausente para arquivos novos.

## Definição de pronto

- Quality Gate do SonarCloud: `OK`.
- Reliability e Security no código novo: A.
- Cobertura no código novo: >=80% com relatórios completos e reproduzíveis.
- Duplicação no código novo: <=3%.
- Sem exclusões novas de produção, downgrade de threshold ou supressão sem evidência.
- `pnpm verify`, testes Kotlin, cobertura Rust e scanner passam no mesmo commit.
