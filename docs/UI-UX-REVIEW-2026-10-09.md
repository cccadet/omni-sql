Método: dual-agent (A: /root/design_review · B: /root/technical_evidence).
Data: 2026-10-09. Alvo: apps/desktop/src. Modo: Operate.

# Avaliação da interface e TODO

A estrutura de IDE é adequada: editor dominante, objetos à esquerda e resultados abaixo. Preservar a identidade grafite/amarelo, a densidade técnica e os componentes Fluent. A oportunidade principal é melhorar previsibilidade, descoberta e acesso por teclado.

## Evidência e limites

Revisão independente de UX e evidências técnicas, com código e inspeção em navegador local, viewport 1280×720. Superfícies: shell inicial, conexões restauradas, árvores SQL/S3, cadastro Demo/PostgreSQL/S3, configurações e resultados vazios. Não foram executadas consultas nem criadas/alteradas conexões. Grid preenchida e ações nativas foram avaliadas pelo código; requerem confirmação no app com dados de teste.

Backend e frontend iniciados temporariamente para revisão e encerrados. O 401 inicial foi configuração de autenticação do preview, resolvida; erros de invoke sem Tauri e competição MCP entre abas não são achados do produto. Sem validação NVDA, contraste medido, zoom 200% ou E2E UI → Tauri → banco.

## Saúde de design

Notas heurísticas, não métricas automatizadas de acessibilidade.

| Heurística | Nota /4 | Principal observação |
|---|---:|---|
| Visibilidade de estado | 3 | Estado de conexão/execução claro; teste de conexão sem anúncio adequado |
| Correspondência com o mundo real | 3 | Vocabulário SQL apropriado; Connect significa testar |
| Controle e liberdade | 3 | Cancelamento/descarte presentes; grid depende de clique |
| Consistência e padrões | 2 | Idiomas misturados e campos desalinhados |
| Prevenção de erros | 3 | Limites, análise de risco e aplicação explícita de edições |
| Reconhecimento em vez de lembrança | 2 | Primeiro passo pouco visível |
| Flexibilidade e eficiência | 3 | Atalhos, histórico e busca; lacunas de teclado na grid |
| Estética e minimalismo | 3 | Shell enxuto; ferramentas prematuras no vazio |
| Diagnóstico e recuperação | 2 | Mensagens preservam formulário, mas nem sempre orientam recuperação |
| Ajuda e documentação | 2 | Tooltips/hints presentes; entrada sem condução |
| **Total** | **26/40** | **Aceitável, com melhorias operacionais relevantes** |

## O que funciona

- Hierarquia espacial familiar a usuários de SQL, com conexão/dialeto visíveis.
- Run textual, limite explícito, cancelamento e avisos de risco acompanhados de texto.
- Formulários agrupados, Cancel e Save visíveis; árvore com Enter/Espaço e estado expanded.
- Grid separa alterações pendentes da aplicação no banco e anuncia execução em andamento.

## Cinco prioridades

1. **P1 — Grid por teclado.** Cabeçalhos ordenáveis e células editáveis dependem de clique; ausência de aria-sort e nome contextual do editor. Evidência de código em ResultsGrid.tsx:761–816 e 883–903. Impacto: fluxo parcial para teclado/leitor de tela. Corrigir interação e semântica; confirmar com resultado preenchido antes de declarar bloqueio total. Comando sugerido: impeccable harden.
2. **P2 — Primeiro uso sem próximo passo.** Vazio inicial mostra No connections configured/No objects available/No results e muitos comandos; criar conexão está num + pequeno. Expor CTA Criar conexão e caminho secundário Demo/importação; reduzir controles de resultado sem dados. Sidebar.tsx:807, ResultsGrid.tsx:758. Comandos: impeccable onboard e distill.
3. **P2 — Cadastro de conexão ambíguo.** Connect executa connection.test, mas sucesso ainda exige Save connection. Ao trocar PostgreSQL → S3, Access Key ID recebe postgres; foi reproduzido sem salvar. Renomear teste/sucesso, anunciar feedback e separar estados de autenticação. ConnectionDialog.tsx:241, 301–306, 432–434, 568–579. Comandos: impeccable clarify e harden.
4. **P2 — Configurações desalinhadas.** Chevrons dos Select fora da borda visível; rótulos/inputs perdem associação em 1280×720. Revisar Field, sizing e colunas sem trocar o sistema visual. FormatSettings.tsx:153–198. Comando: impeccable layout.
5. **P2 — Consistência e descoberta.** S3 mostra português em locale inglês; More options não faz nada; pesquisas de Objects sem nome acessível específico. Traduzir, retirar/implementar controle vazio e rotular buscas. Sidebar.tsx:949–956, FormatSettings.tsx:230, Toolbar.tsx:166. Comandos: impeccable clarify e harden.

## Carga cognitiva e jornada

No vazio, a toolbar oferece pelo menos 13 ações antes da primeira conexão; o agrupamento ajuda o usuário experiente, mas falta direção ao iniciante. A grid mantém controles que não ajudam enquanto não existem dados. Não impor um teto artificial de quatro objetos à árvore SQL: sua densidade é parte do trabalho.

A entrada parece profissional, mas o iniciante pode hesitar no primeiro passo. Cadastro ganha confiança com defaults e hints; Connect → Save quebra a expectativa de conclusão. A execução oferece um ciclo claro; a grid precisa equivalência de teclado. Configurações têm footer previsível, mas desalinhamento reduz confiança.

## Personas

- Alex, usuário experiente: bons atalhos e organização; perde tempo com More options vazio e Connect ambíguo.
- Jordan, iniciante: precisa localizar qual + cria conexão; Demo fica entre dez tipos, sem condução no vazio.
- Sam, teclado/leitor de tela: árvore e toolbar têm bons recursos; ordenação/entrada na edição da grid e anúncios de teste precisam melhoria.

## Observações menores

Metadados da sidebar em 9–11px merecem teste de zoom. Objects repetido ocupa altura no vazio. Configurações abrem em SQL formatting embora Editor venha primeiro. Abertura de tabela por double-click/contexto merece revisão de descoberta; não foi demonstrado bloqueio integral.

## Detector

Uma ocorrência: regra side-tab, warning/slop, ExecutionRiskDialog.tsx:43. Falso positivo contextual: a borda semântica reforça risco de SQL destrutivo junto de título e SQL. Não remover essa indicação apenas para satisfazer o detector.

Nenhum overlay foi injetado: evaluate disponível é somente leitura. Evidências alternativas: screenshot/árvore de acessibilidade e inspeção de código. O resultado limpo ou quase limpo do detector não estabelece qualidade UX.

## TODO priorizado

- [x] UX-01 · P1 · Grid: cabeçalho com botão focável e aria-sort; navegação/entrada na edição por teclado, foco recuperável e editor nomeado por coluna. Implementado no lote 5; fixture sintética editável/somente leitura verificada. Validação SQL nativa/NVDA permanece em UX-11.
- [x] UX-02 · P2 · Cadastro: separar/resetar autenticação entre SQL/S3. Aceite: PostgreSQL → S3 não preenche Access Key ID com usuário SQL; campos compatíveis têm política explícita e credenciais não migram indevidamente.
- [x] UX-03 · P2 · Cadastro: Test connection/Test successful e status/alert acessível. Aceite: testar não comunica que salvou/ativou; salvar tem conclusão distinta; falha preserva campos e orienta recuperação.
- [x] UX-04 · P2 · Inicial: CTA Criar conexão e opção Demo/importar coerente com o produto. Aceite: primeira ação fica clara no vazio, sem depender de distinguir dois +; tarefas existentes seguem disponíveis.
- [x] UX-05 · P2 · Resultados vazios: distinguir ainda não executado, consulta sem linhas, carregamento e erro. Aceite: cada estado informa próximo passo; ações impossíveis ficam desabilitadas/ocultas com critério consistente.
- [x] UX-06 · P2 · Configurações: corrigir alinhamento de Select/Field e rótulos. Aceite: setas dentro dos controles e relação campo/rótulo clara em 1280×720 e janela menor; preview e footer acessíveis com scroll.
- [x] UX-07 · P2 · SQL/S3: mover textos para i18n, incluindo nomes acessíveis. Aceite: inglês e pt-BR coerentes nas árvores, diálogos e configurações.
- [x] UX-08 · P2 · Sidebar: nome acessível para cada pesquisa; ação de abrir objeto descobrível por teclado. Aceite: busca anuncia propósito e navegação SQL/S3 pode ser concluída sem mouse.
- [x] UX-09 · P2 · Toolbar: retirar ou implementar More options. More inerte removido no lote 1; validação do usuário pendente.
- [ ] UX-10 · P3 · Acabamento: textos pequenos da sidebar/contexto ajustados no lote 6; título Objects repetido e categoria inicial de Settings concluídos nos lotes anteriores. Janela reduzida verificada; zoom 200%/escala do app nativo ainda pendentes. Aceite: leitura em zoom/escala alta sem perda funcional e ordem inicial previsível.
- [ ] UX-11 · Validação pendente · App nativo: árvores SQL com muitos objetos e S3 com buckets/prefixos/erros; grid preenchida, colunas largas, NULL/vazio, paginação/filtro/exportação/edição. Aceite: registrar evidência UI → Tauri → sidecars → fixtures sem dados/segredos de produção; medir contraste e verificar teclado/NVDA.
- [x] UX-12 · P3 · Passe impeccable polish dos ajustes escolhidos, com verificação visual limitada e sem redesenho fora do escopo. Passe no navegador concluído no lote 6; validação nativa permanece em UX-11.
- [ ] UX-20 · P2 · Metadados: ao cadastrar ou editar a conexão, parece ocorrer uma atualização dos metadados, mas o ícone de metadados não reflete o estado atualizado. Relatado pelo usuário em 2026-10-09; confirmar a atualização efetiva antes de corrigir. Aceite: após cadastrar/editar e concluir a atualização, o ícone reflete o estado real; verificar também atualização em andamento e falha.
- [x] UX-21 · P1 · Grid: área de dados praticamente invisível em painel baixo após executar. Reproduzido e corrigido no lote 6: removido gap padrão do Card e garantida área mínima com rolagem de fallback. Detalhes da conexão também quebram em linhas sem sobreposição. Validação nativa do usuário pendente.

Implementação autorizada em lotes em 2026-10-09. Ao terminar cada lote, entregar o que mudou e um roteiro curto de teste; aguardar a validação do usuário antes do próximo. Para cada mudança, selecionar o menor nível de teste que detecte o comportamento, rodar typecheck/lint/testes afetados uma vez e integração quando o caminho exigir, conforme AGENTS.md.

## Layout e organização dos botões

- [x] UX-13 · P2 · Toolbar: agrupar Run/Cancel, EXPLAIN e limite; separar arquivos de análise local; manter ações globais no extremo direito. Implementado no lote 1; reflow em 900 px verificado, zoom/validação nativa do usuário pendentes.
- [x] UX-14 · P2 · Resultados: tabs acima das ações; filtro/Columns à esquerda, inclusão/Aplicar/Descartar juntos e análise/exportação à direita. Implementado no lote 1; vazio, pendências, descarte e reflow verificados com fixture sintética. Validação nativa do usuário pendente.
- [x] UX-15 · P2 · Contexto de execução: avaliar aproximação visual da conexão/dialeto ao grupo Run. Aceite: destino da execução evidente e sem duplicar controles desnecessariamente; preservar seleção e estado atuais.
- [x] UX-16 · P2 · Sidebar: reduzir cabeçalhos repetidos, manter busca junto dos objetos e ações específicas junto da conexão/objeto. Aceite: mais altura útil para árvore, contexto SQL/S3 claro e ações descobríveis.
- [x] UX-17 · P2 · Configurações: menos colunas estreitas, larguras coerentes e prévia próxima das opções que demonstra. Aceite: agrupamento compreensível e sem controles desalinhados.
- [x] UX-18 · P2 · Cadastro: footer Cancelar/Testar conexão/Salvar conexão, com Salvar primário e feedback de teste próximo. Aceite: testar e persistir têm sequência visual inequívoca.
- [x] UX-19 · P3 · Hierarquia de ações: Run, Salvar e Aplicar pendências destacados nos respectivos contextos; ações secundárias discretas e acessíveis. Conferido no lote 6, preservando grafite/amarelo e densidade de IDE.

## Lotes de implementação e validação

| Lote | Escopo | Estado |
|---|---|---|
| 1 | Toolbar e barra de resultados: UX-13/14, remoção do More inerte de UX-09 | Commit a91584b; avanço autorizado pelo usuário |
| 2 | Cadastro SQL/S3: UX-02/03/18 | Commit f2bf7ec; avanço autorizado pelo usuário |
| 3 | Configurações: UX-06/17 e categoria inicial de UX-10 | Commit c0955cb; avanço autorizado pelo usuário |
| 4 | Entrada, sidebar SQL/S3 e contexto: UX-04/05/07/08/15/16 | Commit 0583c5b; avanço autorizado pelo usuário |
| 5 | Grid por teclado: UX-01 | Commit 0f452e4; avanço autorizado pelo usuário |
| 6 | Acabamento e validação nativa: UX-10/11/12/19 | Commit 58d0b20; avanço autorizado pelo usuário; validação nativa pendente |
| 7 | Estado do indicador de metadados: UX-20 | Andamento explícito e descrição acessível implementados; confirmação do relato no app nativo pendente |
| 8 | Controles MongoDB: modo nativo/SQL e conversão | Implementado; commit autorizado pelo usuário; confirmação nativa dos fluxos pendente |

Lote 1 preserva callbacks/contratos de execução, edição e exportação. Estados vazios mais explicativos de UX-05 e comportamento por teclado de UX-01 seguem para seus lotes.

### Entrega do lote 1

Alterados Toolbar.tsx, ResultsGrid.tsx, index.css e teste de ResultsGrid. Nenhum contrato de backend/nativo alterado e nenhuma dependência adicionada.

Verificação local em 2026-10-09, Node v22.23.3 e pnpm 11.17.0 (fnm exec --using v22.23.3; primeira rodada usou Node 26 e foi repetida no runtime requerido):

- Typecheck: pnpm --filter desktop typecheck, passou.
- Lint: pnpm --filter desktop lint, passou com 7 warnings em AnalysisWorkspace.tsx, Editor.tsx e useSession.ts, fora do lote.
- Testes: pnpm --filter desktop exec vitest run src/components/Toolbar.test.tsx src/components/ResultsGrid.test.tsx src/App.test.tsx src/components/AnalysisWorkspace.test.tsx; Vitest 4.1.10, 4 arquivos/64 testes passaram.
- Detector layout antes/depois: zero achados nos dois componentes; avaliação independente de layout e mecânica antes da edição.
- Navegador: shell vazio e componentes reais com fixture sintética em 1280×720 e 900×720; verificados agrupamento, pendência/descarte, vazio e Run/Cancel. Em 900 px, scrollWidth/clientWidth = 900/900 na toolbar e 640/640 nas ações de resultados. Fixture temporária removida, viewport restaurado, aba e servidor temporários encerrados.
- Isso não constitui E2E Tauri/banco, exportação nativa nem validação NVDA. Nenhuma consulta em banco cadastrado foi executada.

Roteiro para o usuário no app em desenvolvimento:

1. Conferir toolbar em janela ampla e reduzida: execução/limite, arquivos, análise local e globais; nenhuma ação cortada.
2. Sem resultado, conferir que tabs permanecem e filtro/colunas/exportação/Aplicar não aparecem.
3. Executar consulta numa fixture: filtrar, abrir Columns e conferir grupo de exportação/análise.
4. Em tabela editável de teste, alterar uma célula e finalizar edição: Aplicar/Descartar aparecem juntos. Descartar deve remover a pendência; aplicar somente em dados de teste.
5. Conferir execução/cancelamento e acesso a salvar/abrir, histórico, biblioteca e configurações. Exportação nativa e análise local precisam teste real.

O usuário autorizou avançar para o lote 2 em 2026-10-09.

### Entrega do lote 2

Credenciais SQL e S3 agora têm estados separados, preservados ao alternar o tipo. Abrir ou duplicar uma conexão continua sem preencher o segredo salvo. O rodapé reúne Cancelar, Testar conexão e Salvar conexão, alinhados à direita, com Salvar como ação principal. O retorno do teste fica acima dos botões, com status/alerta acessível; editar um campo remove o retorno anterior. Testar continua sem persistir a conexão.

Verificação em Node v22.23.3 / pnpm 11.17.0: typecheck passou; lint passou com os mesmos 7 warnings fora do lote; ConnectionDialog.test.tsx e i18n.test.tsx passaram (16 testes). Testes cobrem troca SQL/S3/SQL, credenciais enviadas ao salvar, teste sem persistência, remoção de resultado antigo, falha/retry e os fluxos existentes de S3, duplicação e MongoDB. Navegador: formulário SQL em 1280×720 e S3 em 900×720, sem corte dos botões; campos S3 vazios após usuário SQL preenchido. Backend não iniciado nesta inspeção; nenhuma conexão cadastrada ou consultada. Isso não valida Tauri/keyring/AWS reais.

Roteiro para teste no app:

1. Digitar usuário/senha SQL, alternar para S3: as chaves devem estar vazias. Preencher chaves de teste e voltar para SQL: os valores SQL devem permanecer.
2. Testar uma conexão de desenvolvimento: conferir sucesso/falha junto ao rodapé, sem salvar automaticamente. Editar Host ou outro campo deve remover o retorno antigo.
3. Salvar uma conexão de teste, reabrir e duplicar: conferir usuário correto, segredo vazio e preservação do segredo salvo conforme fluxo existente.
4. Conferir SQL e S3 em janela menor, com o conteúdo rolável e Cancelar/Testar/Salvar acessíveis.

O usuário autorizou o commit do lote 2 e o avanço para o lote 3 em 2026-10-09. Commit f2bf7ec, hook passou; sem push.

### Entrega do lote 3

Configurações abre em Editor, seguindo a ordem das categorias. Campos de formatação usam Field com rótulo associado; Select mantém a estrutura Fluent, corrigindo os chevrons deslocados. Capitalização/Layout usam duas colunas previsíveis, com controles alinhados mesmo quando o rótulo ocupa duas linhas. As opções booleanas usam Checkbox Fluent.

Em janela ampla, opções à esquerda e prévia à direita; abaixo de 900 px, opções e prévia ficam em sequência, com rolagem no corpo. Abaixo de 520 px, campos ficam em uma coluna. A prévia distingue SQL de entrada e SQL formatado, com rótulos em EN/PT-BR. Mantidos formatter, defaults e callbacks de salvar/cancelar.

Verificação: Node v22.23.3 / pnpm 11.17.0; typecheck passou; lint passou com os 7 warnings existentes fora do lote; FormatSettings.test.tsx, i18n.test.tsx e format-sql.test.ts passaram (3 arquivos, 22 testes). Teste observa atualização da prévia e preservação de escolhas/SQL ao trocar categorias. Detector layout antes/depois sem achados; whitespace passou. Avaliação independente de layout confirmou estrutura e separação opções/prévia.

Navegador: abertura em Editor; formatação em 1280×720 e 800×720. Na largura ampla, seis wrappers Select mediram clientWidth/scrollWidth 213/213, sem overflow, e chevrons dentro dos controles. Rodapé acessível em ambas. Cancelado sem salvar preferências; servidor temporário encerrado. Zoom 200%, leitor de tela e persistência após reabrir ainda dependem do teste no app.

Roteiro para o usuário:

1. Abrir Configurações: Editor deve estar selecionado.
2. Em Formatação SQL, alterar capitalização/indentação e conferir prévia imediatamente. Trocar de categoria e voltar: escolhas e SQL de entrada devem permanecer.
3. Conferir os selects e rótulos em janela ampla/reduzida e em português; prévia passa para baixo em janela estreita.
4. Salvar, reabrir e conferir persistência; testar Cancelar e Restaurar padrões. Atalho inválido continua impedindo salvar.

Usuário autorizou commit do lote 3 e avanço ao lote 4 em 2026-10-09.

Ajuste solicitado no rodapé: padding superior de 12 px entre divisor e botões, com gap de 8 px entre ações e especificidade suficiente para o Fluent. Conferido no navegador em 1280×720 e 800×720: padding computado 12 px em ambos; rodapé estreito sem overflow (clientWidth/scrollWidth 719/719). Alteração apenas CSS; não repetidos testes de comportamento já aprovados.

Após a entrega, o usuário pediu anonimização do exemplo SQL. A prévia usa DW.TEST_TABLE; fixtures do formatador e Oracle foram anonimizadas também. A captura anterior do lote 3 foi removida por conter o identificador. Testes afetados: 19 desktop passaram; Oracle 20 passaram e 1 integração opcional foi ignorada por falta de fixture. Isso altera arquivos atuais, sem reescrever histórico Git.

### Entrega do lote 4

Nova conexão textual no vazio, com orientação para Demo no cadastro; importação local permanece na toolbar. Removido o título Objects repetido no vazio e compactada a linha de ferramentas. Busca de objetos/pastas/S3 com nomes acessíveis; textos de prefixo, catálogo, JOIN, pasta e estado da conexão passam pelo i18n EN/PT-BR, incluindo o diálogo de importação de outro banco.

Tabelas e views oferecem botão focável para abrir consulta em nova aba, preservando expansão e inserção separados; MongoDB usa a operação nativa existente e DuckDB mantém excluir dataset. Abrir usa o callback existente e não executa automaticamente. Contexto da conexão movido do header para antes de Executar, sem nova seleção nem cópia no header; nome e detalhes extensos têm tooltip e truncamento. A toolbar pode ocupar duas linhas conforme espaço disponível.

Resultados distinguem primeira execução, consulta sem linhas, filtro sem correspondência e falha; DML sem linhas exibe contagem afetada. Loading e escolha automática de Mensagens em erro preservados; erro anunciado com role alert. Não alterados protocolos, drivers, persistência ou dados.

Verificação visual em 1280×720 e 900×720, com componentes reais e fixture sintética temporária, além do shell real vazio. Enter expandiu árvores SQL/S3 e abriu consultas de tabela; CTA inicial abriu o cadastro sem salvar. Em 900 px, clientWidth/scrollWidth da toolbar 900/900, contexto 44 px de altura. Detector layout antes/depois sem achados. Fixture removida, viewport restaurado, aba e frontend temporários encerrados. Backend não iniciado; erro de conexão do preview não foi interpretado como falha do produto. Sem validação Tauri/AWS/banco/NVDA/zoom 200%.

Validação local em Node v22.23.3 / pnpm 11.17.0: typecheck final passou; lint passou com os 7 warnings anteriores fora do lote; lint específico de App e testes ajustados passou sem warnings. Vitest 4.1.10: Sidebar, ResultsGrid, Toolbar e i18n passaram; App repetido após ajustar a seleção do novo CTA passou (34 testes). Total final: 5 arquivos / 79 testes aprovados. A primeira rodada teve uma falha por seleção ambígua entre o ícone e CTA Nova conexão; corrigida sem remover nenhum dos acessos. Whitespace passou.

Roteiro para o usuário:

1. No vazio, abrir cadastro pelo botão Nova conexão; conferir orientação Demo e acesso à importação local.
2. Selecionar conexões com nomes longos: conferir nome/dialeto/banco junto de Executar, tooltip e reflow da toolbar.
3. Expandir SQL/S3 por teclado, focar Abrir objeto e usar Enter: nova aba deve conter a consulta, sem executá-la. Conferir também views e manter inserir/excluir dataset.
4. Conferir EN/PT-BR: busca, prefixo/Listar, DuckLake e diálogo de adicionar tabela ao JOIN.
5. Testar resultado sem linhas, filtro sem correspondência, execução/falha e tabs Mensagens.

Itens UX-04/05/07/08/15/16 marcados como implementados; validação nativa do usuário continua pendente em UX-11. UX-10 ainda cobre tipografia/zoom; apenas categoria inicial e título duplicado já concluídos. UX-20 permanece pendente, sem alteração no indicador de metadados nesta entrega. Usuário autorizou commit do lote 4 e avanço ao lote 5 em 2026-10-09.

### Entrega do lote 5

Cabeçalhos de resultados têm botão focável para ordenar com Enter/Espaço e aria-sort indicando a direção. Ordenação identifica a coluna por índice, permitindo colunas com nomes repetidos. A tabela mantém HTML semântico; um único ponto de entrada por Tab nas células evita centenas de paradas. Setas navegam na página entre colunas visíveis; Home/End vão ao início/fim da linha e Ctrl+Home/End à primeira/última célula da página. Filtro e controles não têm suas setas interceptadas.

Enter/F2 abre edição somente quando permitida, com nome acessível contendo coluna e linha original. Enter finaliza a edição como pendência; Escape cancela. Ambos devolvem o foco à célula, assim como Aplicar/Descartar após remover as ações de pendência. Indicador de foco usa dois tons dos tokens Fluent para continuar visível na seleção amarela. Instruções, contagem de pendências anunciada por status e nomes dos botões de paginação têm EN/PT-BR. Aplicar continua explícito; contratos e persistência não mudaram, nem foram adicionadas dependências.

Verificação local: Node v22.23.3 / pnpm 11.17.0. Typecheck final passou; lint geral passou com os 7 warnings anteriores fora do lote e lint final dos arquivos alterados passou sem warnings. Vitest 4.1.10: ResultsGrid.test.tsx e i18n.test.tsx, 2 arquivos / 25 testes passaram, incluindo ordenação com nomes repetidos, edição de linha ordenada, cancelamento/aplicação/descarte, retorno de foco, somente leitura e navegação após paginação/filtro/ocultação de coluna. Detector layout de ResultsGrid sem achados; whitespace passou. Hook do commit 0583c5b passou, sem push.

Navegador com componentes reais, tema do app e dados sintéticos, em 1280×720 e 900×720: ordenar por Enter/Espaço, entrar nas células por Tab, navegar, editar, cancelar, criar pendência, aplicar e descartar por teclado. Aplicação chamou somente o callback sintético; retorno de foco confirmado. Resultado somente leitura não abriu editor por F2. Orientação/contagem cabem em 900 px (clientWidth/scrollWidth 868/868); EN/PT-BR conferidos. Fixture removida, viewport restaurado, aba e frontend temporários encerrados. Sem backend/consulta a banco cadastrado, E2E Tauri, NVDA, alto contraste ou zoom 200%.

Roteiro para teste no app com dados de desenvolvimento:

1. Ordenar cabeçalho usando Tab + Enter/Espaço; conferir crescente/decrescente, inclusive colunas com nomes repetidos.
2. Entrar nas células por Tab e usar setas, Home/End; filtrar, ocultar uma coluna e trocar de página, mantendo acesso às células visíveis.
3. Em resultado editável, usar Enter/F2, alterar valor e Escape: não deve criar pendência. Repetir com Enter: deve criar pendência sem gravar no banco, com foco na célula.
4. Descartar por teclado e conferir retorno à célula. Aplicar somente em dados de teste; conferir gravação e retorno do foco.
5. Em resultado somente leitura, Enter/F2 não deve abrir editor; conferir instruções e nomes dos controles em EN/PT-BR.

Usuário autorizou commit do lote 5 e avanço ao lote 6. UX-20 segue pendente.

### Entrega do lote 6

Revisão solicitada pelo usuário: removido o contexto de conexão ao lado de Run, pois já aparece em Objetos e no rodapé. Removidos também a prop executionContext e os estilos exclusivos desse bloco. Run passa a iniciar a toolbar; ações e callbacks permanecem. Esta decisão substitui a posição do contexto proposta no lote 4 e os ajustes intermediários abaixo. Typecheck, lint de App/Toolbar e whitespace passaram; App.test.tsx e Toolbar.test.tsx passaram (38 testes, Vitest 4.1.10, Node v22.23.3 / pnpm 11.17.0). Sem commit; teste visual nativo do usuário pendente.

Ajuste após o segundo print: contexto junto de Run organizado em duas linhas, com conexão/estado acima e dialeto/banco abaixo; banco extenso mantém truncamento e tooltip. Ações globais têm espaço reservado à direita e os grupos secundários passam a ícones até 1400 px, evitando a linha quase vazia de utilitários. Preview com componentes reais e fixture sintética em 1280×720 e 900×720: toolbar sem overflow (clientWidth/scrollWidth 1280/1280 e 900/900); altura de aproximadamente 53 e 89 px. Typecheck e lint de App/Toolbar passaram; App.test.tsx e Toolbar.test.tsx passaram (38 testes, Vitest 4.1.10, Node v22.23.3 / pnpm 11.17.0). Fixture removida, viewport restaurado e preview encerrado. Sem consulta real ou validação da escala nativa; ajuste permanece no lote 6 sem commit para teste do usuário.

Correção após o print do usuário: UX-21 · Grid sem altura útil após executar. Reproduzido com cinco linhas sintéticas em painel de 224 px: Card Fluent tinha gap computado de 12 px e área da tabela com apenas 6 px. Card agora usa gap 0, controles sem compressão, área de dados mínima de 80 px e rolagem externa de fallback quando toda a interface não cabe. Confirmados 80 px para dados e navegação por Ctrl+End até a última célula visível. Detalhes de conexão passam a quebrar em linhas, evitando sobreposição de banco/status. Validação final desta correção: typecheck passou; lint passou com os mesmos 7 warnings fora do lote; ResultsGrid.test.tsx e Toolbar.test.tsx passaram (2 arquivos / 26 testes, Vitest 4.1.10, Node v22.23.3 / pnpm 11.17.0); detector layout sem achados e whitespace passou. Fixture removida e frontend/aba temporários encerrados; nenhuma consulta real executada. Ajuste incorporado ao lote 6 ainda sem commit, aguardando teste nativo do usuário.

Rótulos de seções, pastas, ativação, saúde da conexão, limite/contexto de execução e subseções/avisos de metadados ganharam tamanhos mais legíveis (principalmente 12 px). Badges PK/FK e formatos S3 passaram de 9 para 11 px; preservadas densidade, truncamento e estrutura da sidebar. Opções de capitalização, indentação e posição do AND/OR agora usam EN/PT-BR, mantendo os mesmos valores do formatter.

Pendências na grid usam colorPaletteYellowForeground2 sobre colorPaletteYellowBackground1. Medição das cores computadas: contraste anterior no tema escuro 4,35:1; após o ajuste 8,98:1 no escuro (#fef7b2 / #4c4400) e 4,68:1 no claro (#817400 / #fffef5). Essa medição cobre o texto de pendências, não certifica toda a interface. Mantidos o amarelo semântico, contagem de pendências e aplicação explícita. Nenhum contrato, callback de persistência ou dependência alterado.

Passe visual Impeccable em componentes reais com fixture sintética, temas do app, EN/PT-BR e 1280×720, 900×720 e 640×360. Hierarquia Run/Aplicar/Salvar e ações secundárias conferida. Cabeçalhos da sidebar mediram 12 px e badges 11 px. Toolbar sem overflow em 1280 px. Configurações em 640×360: diálogo 608×328 dentro da viewport; rodapé clientWidth/scrollWidth 559/559 e todas as ações acessíveis. A viewport reduzida verifica reflow; não substitui zoom 200% nem escala do Windows. Erros de backend/sidecar no preview e recarregamento de contexto durante HMR da fixture não foram classificados como defeitos do app. Fixture removida, viewport restaurado, aba e frontend temporários encerrados; nenhuma consulta ou conexão real criada.

Validação final em Node v22.23.3 / pnpm 11.17.0: pnpm --filter desktop typecheck passou; pnpm --filter desktop lint passou com os 7 warnings anteriores fora do lote. pnpm --filter desktop exec vitest run src/components/Sidebar.test.tsx src/components/ResultsGrid.test.tsx src/components/FormatSettings.test.tsx src/components/ConnectionDialog.test.tsx src/components/Toolbar.test.tsx src/i18n.test.tsx: Vitest 4.1.10, 6 arquivos / 65 testes passaram. Detector layout de Sidebar, ResultsGrid e FormatSettings sem achados; whitespace passou. Alterações visuais/localização não receberam testes que apenas espelham CSS; cobertura comportamental existente executada. Estado: lote 5 no commit 0f452e4; lote 6 no working tree, sem push. Hook do commit do lote 5 passou.

Roteiro para teste no app:

1. Conferir rótulos de Conexões/Objetos, pastas, PK/FK e formatos S3 com muitos objetos; verificar nomes longos e estado da conexão.
2. Em ambos os temas, criar uma pendência numa tabela de desenvolvimento e conferir legibilidade, foco e Aplicar/Descartar.
3. Trocar EN/PT-BR e conferir opções de Formatação SQL; alterar uma opção e conferir prévia/salvamento.
4. Reduzir a janela e testar escala/zoom 200% no ambiente nativo: toolbar, sidebar, configurações e cadastro precisam continuar operáveis.
5. Para concluir UX-11, ainda executar fixtures reais SQL/S3 via Tauri/sidecars e verificar NVDA, exportação, edição, falhas e muitos objetos.

Lote 6 sem commit, aguardando teste do usuário. UX-10 permanece parcialmente pendente por zoom/escala nativa; UX-11 permanece pendente. UX-12/19 concluídos no passe web. UX-20 (indicador de metadados após cadastro/edição) continua pendente e não foi alterado neste acabamento.

### Entrega do lote 7

Inspeção do fluxo: salvar SQL chama metadata.introspect, o backend grava lastSyncedAt ao concluir e o frontend recarrega connection.list. Não foi demonstrada perda da data nesse fluxo. Lacuna reproduzida: o controle não expõe a descrição de atualidade ao leitor de tela; durante introspecção mantém o ícone anterior e permite nova solicitação. Agora o estado em andamento é mantido por conexão até concluir introspecção e recarregamento, com spinner, aria-busy e bloqueio do botão. Sucesso usa a data devolvida pelo backend; falha prevalece sobre sincronização anterior. Sem mudança em backend, cache, protocolos ou credenciais.

Teste de regressão antes da correção falhou por descrição ausente. Teste do primeiro cadastro aguarda uma introspecção sintética, confere o controle ocupado/desabilitado e depois a data atualizada e liberação. Sidebar cobre sucesso, andamento e falha com sincronização anterior. Preview dos três estados com componentes reais em 1280×720; fixture removida, viewport restaurado e frontend/aba encerrados. Não equivale a Tauri/banco ou NVDA; UX-20 permanece pendente para confirmar o relato original no ambiente nativo.

Roteiro do lote 7: cadastrar ou editar conexão SQL de desenvolvimento; durante atualização conferir spinner e botão indisponível; ao concluir conferir indicador verde e data no tooltip. Repetir com falha de acesso e conferir erro, sem representar a sincronização anterior como sucesso atual. Trocar a conexão durante a atualização para conferir que o estado fica associado à conexão correta. Lote 7 sem commit para teste do usuário; lote 6 commitado em 58d0b20, hook aprovado, sem push.

Verificação final: Node v22.23.3 / pnpm 11.17.0; typecheck e lint dos quatro arquivos alterados passaram; Vitest 4.1.10, App.test.tsx e Sidebar.test.tsx, 57 testes aprovados. Whitespace passou. UX-10/11 ainda requerem validação nativa.

### Entrega do lote 8

Usuário autorizou commit após refinamentos de cor e posição. Teste final de Toolbar.test.tsx após mover o grupo para depois de DuckDB/importar: 4 testes aprovados; whitespace passou. Sem push.

Posição final solicitada pelo usuário: grupo MongoDB depois de DuckDB/importar e antes das ações globais. Run, limite, arquivos e análise local preservam a mesma ordem com ou sem MongoDB; ordem de teclado acompanha o DOM. Sem commit.

Após os prints do usuário, substituído o verde saturado por mistura de 8% do verde com o fundo neutro, reduzidos cantos a 4 px e aplicado fundo neutro ao botão em repouso. O verde fica somente no entorno dos controles; hover/pressionado continuam Fluent. Dimensões preservadas. Conferência visual nativa pendente.

Refinamento solicitado: fundo verde discreto no grupo MongoDB usando colorPaletteGreenBackground1, cantos de 6 px e padding vertical de 2 px. Preview sintético com Toolbar/controles Fluent nos temas escuro e claro: em 1280×720, altura permaneceu aproximadamente 51 px e clientWidth/scrollWidth 1280/1280 em ambos; DuckDB/importar na mesma linha. Fixture removida, viewport restaurado e preview encerrado. Mudança somente CSS, sem novos testes comportamentais; sem commit, aguardando conferência nativa do usuário.

Lote 7 commitado em 04cf8bf, hook aprovado, sem push. MongoDB: removido o toggle SQL da sidebar, que comprimia o nome da conexão; escolha de Extended JSON / SQL (somente leitura) e conversão reunidas na toolbar do Run. Botão de conversão agora tem borda e texto visível, mantendo o hint existente e a conversão sem execução. Removida a faixa de modo abaixo das abas para devolver altura ao editor. Textos separados de cada modo, modo por aba, bloqueio durante execução, erros e proteção contra conversão tardia preservados.

O primeiro ajuste ocupava duas linhas em 1280 px e deixava DuckDB/importar sozinhos. Conforme feedback do usuário, removido rótulo MongoDB duplicado e usado Extended JSON como opção compacta; nome acessível do seletor mantido. Preview do App real com backend sintético em 1280×720: toolbar em uma linha, altura aproximada 51 px e clientWidth/scrollWidth 1280/1280. Em 900×720, altura aproximada 77 px e 900/900, sem faixa abaixo das abas. Apenas dados demo no preview; não foram usados os nomes/dados dos prints do usuário. Fixture removida, viewport restaurado, aba/frontend encerrados. Isso não valida MongoDB/Tauri reais.

Roteiro: alternar Extended JSON/SQL por teclado e conferir recuperação dos textos; trocar de aba e conferir modo independente; escrever /mongo seguido de SELECT em fixture e usar Converter SQL para MongoDB, conferindo que não executa; testar janela/escala usuais e confirmar DuckDB/importar na mesma linha quando houver espaço. Lote 8 permanece sem commit para teste do usuário.

Verificação final em Node v22.23.3 / pnpm 11.17.0: typecheck e lint dos arquivos alterados passaram; App.test.tsx e Toolbar.test.tsx passaram, 38 testes (Vitest 4.1.10). A rodada anterior de App/Sidebar também passou, 57 testes. Detector layout antes/depois sem achados; whitespace passou. Testes existentes de modo por aba, preservação dos textos, conversão sem executar, falha e conversão tardia foram adaptados ao seletor. Validação Tauri/MongoDB real, NVDA e escala nativa continua pendente.

## Decisões registradas

- Começar pela organização da toolbar e resultados, em lotes testados pelo usuário.
- Na entrada, manter Criar conexão como ação principal proposta e Demo/importação como secundárias; confirmar o resultado ao testar o lote 4.
