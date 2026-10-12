# Avaliação da issue #11: delimitador de CSV

Data: 2026-10-12. Referência: [issue #11](https://github.com/cccadet/omni-sql/issues/11), aberta, label `enhancement`, sem responsável, milestone ou comentários no momento da consulta. Análise sobre o checkout `39fd35de16dfed5696e23fae18ea880c5fd62c2a`; já existia conteúdo não rastreado em `docs/distribution/`, preservado.

**Escopo aprovado após esta avaliação:** seleção de delimitador em importação/exportação locais, incluindo **prévia antes da importação**, seguindo o visual existente com a skill impeccable. S3 continua fora desta entrega. A avaliação original abaixo descreve a situação anterior; a seção de implementação ao final registra a mudança.

## Parecer

A demanda é válida e tecnicamente viável sem dependências novas. Recomendo prioridade média: melhora interoperabilidade com ferramentas que usam ponto e vírgula ou tabulação e reduz importações com colunas interpretadas incorretamente. Essa prioridade é uma proposta; a issue ainda não a define. O esforço é moderado, principalmente pela quantidade de entradas na interface e pela necessidade de validar o contrato TypeScript → Tauri → Rust.

O escopo mínimo completo cobre as duas entradas de importação local e todas as entradas de exportação CSV. S3 deve ser explicitamente definido como extensão ou parte do mesmo trabalho: usa outro leitor e hoje tem autodetecção. Uma alteração apenas no painel de análise deixaria os demais caminhos inconsistentes.

## Comportamento atual e pontos afetados

| Caminho | Evidência no código | Comportamento atual / alteração necessária |
| --- | --- | --- |
| Importação local pela interface principal | `apps/desktop/src/App.tsx:844`, `onImportLocalFile` | Seleciona arquivo e importa imediatamente; precisa permitir configurar CSV antes de iniciar. |
| Importação local no painel analítico | `apps/desktop/src/components/AnalysisWorkspace.tsx:231`, `importFile` | Mesmo problema; preserva opções integral, primeiras N linhas e reservoir. |
| Contrato da importação | `apps/desktop/src/lib/analysis.ts`, `importAnalysisFile`; `data_engine.rs:234`, `FileImportRequest` | Não há delimitador no payload. |
| Leitura do CSV local | `apps/desktop/src-tauri/src/data_engine.rs:2015`, `open_file_batches` | Arrow com cabeçalho e vírgula padrão. Infere tipos em até 10.000 registros, volta ao início e lê em lotes de 1.000. Delimitador precisa chegar à inferência e à leitura. |
| Exportação da grade | `apps/desktop/src/components/ResultsGrid.tsx:109`, `escapeCsv`, e `:328`, `handleExportCsv` | Escape e junção fixos em vírgula. Exporta `sortedRows`, considerando edições pendentes, e não reexecuta a consulta completa. |
| Escrita da grade | `apps/desktop/src/lib/file-io.ts:20`; `apps/desktop/src-tauri/src/lib.rs:1205`, `write_csv_file` | Rust recebe o texto já serializado e apenas escolhe o destino e escreve. Não precisa receber delimitador para serializar novamente. |
| Exportação completa na interface principal | `apps/desktop/src/App.tsx:1168`, `exportFullLocalCsv` | Executa a consulta no motor local, com controle de operação e cancelamento. |
| Exportação completa no painel analítico | `apps/desktop/src/components/AnalysisWorkspace.tsx:213`, `exportResult` | Usa a mesma API de exportação, também oferecendo Parquet. |
| Contrato e exportação nativa | `apps/desktop/src/lib/analysis.ts`, `exportAnalysis`; `data_engine.rs:496`, `ExportRequest`, e `:1670`, `export_query_inner` | Arrow Writer com vírgula padrão. Publicação do arquivo e `.omni.json` usa temporários e recuperação em falha. |
| CSV em S3 | `data_engine.rs:320`, `s3_scan_function`; chamadas nas linhas 1291, 1395 e 1472 | DuckDB `read_csv_auto` em consulta direta, catálogo e importação. Exige tratamento próprio caso incluído. |

Não encontrei uma prévia dedicada de CSV local antes da importação nesses fluxos. A grade após importar não é uma prévia de configuração. A condição da issue “onde houver prévia” não exige criar uma nesta entrega.

O contrato principal é Tauri, em `analysis.ts` e nas estruturas Rust, e não o JSON-RPC do backend. Não há necessidade identificada de mudar os drivers de banco ou o JVM para esta funcionalidade.

## Decisões recomendadas

1. Oferecer **vírgula (,)**, **ponto e vírgula (;)**, **tabulação (Tab)** e **personalizado**. A tabulação deve virar o caractere real `\t` no payload, não os dois caracteres barra e letra t.
2. Manter **vírgula como padrão na importação local e em todas as exportações**, incluindo chamadas antigas que omitam o campo. Não introduzir autodetecção local nesta issue: seria outro comportamento com ambiguidades próprias.
3. Para personalizado, aceitar **um único byte ASCII imprimível, exceto aspas duplas**, ou tabulação. Isso inclui `|`; espaço pode ser aceito, mas deve ter identificação visível. Rejeitar vazio, múltiplos caracteres, Unicode multibyte como `é`/emoji, NUL, CR, LF e demais controles. Não usar `trim()` na validação, pois removeria tabulação ou espaço válidos.
4. Usar um campo opcional `delimiter?: string` no contrato TS e `Option<String>` no Rust, validado na fronteira nativa e convertido para `u8`. Mensagem clara também na interface; a validação Rust continua necessária para chamadas diretas. Se um campo explícito vier junto de Parquet/JSON/Arrow IPC, rejeitar como opção incompatível; a interface deve omiti-lo.
5. Mostrar opções apenas em operações CSV. Na importação, selecionar arquivo → configurar delimitador → confirmar importação. Na exportação, selecionar delimitador → escolher destino → gravar. Cancelar em qualquer etapa encerra a operação sem iniciar importação ou escrita.
6. Compartilhar a escolha de opções entre os pontos da interface que precisam do mesmo fluxo, seguindo os componentes existentes. Não criar framework de importação, preferência global ou persistência apenas para esta demanda. Traduzir controles e erros em inglês e português e manter navegação por teclado e rótulos acessíveis.

O Arrow **58.4.0**, efetivamente resolvido no `Cargo.lock` e inspecionado no cache local de fontes, oferece `Format::with_delimiter(u8)`, `ReaderBuilder::with_format(Format)`/`with_delimiter(u8)` e `WriterBuilder::with_delimiter(u8)`. Usar o mesmo `Format` na inferência e no leitor evita divergência. A [documentação do Arrow](https://arrow.apache.org/rust/arrow_csv/reader/struct.ReaderBuilder.html) também descreve essa configuração; a [documentação do writer](https://arrow.apache.org/rust/arrow_csv/writer/struct.WriterBuilder.html) descreve o delimitador de um byte.

## Implementação mínima proposta

1. Adicionar contrato opcional e validação do delimitador; preservar defaults quando omitido. Atualizar todos os literais das estruturas Rust, incluindo staging interno de JSON/S3 em Parquet, sem propagar opções CSV para arquivos temporários Parquet.
2. Na importação Arrow, construir um único formato com cabeçalho e delimitador e reutilizá-lo na inferência e leitura. Preservar limites, lotes, seleção, transação e cancelamento.
3. Na exportação Arrow, configurar o writer com o delimitador escolhido antes de escrever lotes. Preservar proteção contra fórmulas e publicação do bundle.
4. Na grade, parametrizar `escapeCsv(value, delimiter)` e substituir a vírgula fixa na junção de cabeçalho e linhas. Colocar aspas quando o valor contiver o delimitador selecionado, aspas, CR ou LF; duplicar aspas internas. Não substituir caracteres no CSV pronto.
5. Conectar controles às duas importações e às três entradas de exportação: grade, completo na interface principal e completo no painel analítico. O callback `onExportFullCsv` precisa transportar a seleção se o controle ficar na grade; evitar dois diálogos consecutivos para a mesma escolha.

O `.omni.json` pode registrar o delimitador efetivo na exportação completa, favorecendo rastreabilidade; é recomendação de baixo custo, não requisito atual da issue. Não é necessário mudar a persistência dos datasets se não houver reimportação automática a partir da origem.

## S3: fronteira de escopo

Recomendo a primeira entrega com **arquivos locais e todas as exportações CSV**, documentando S3 como extensão separada. A área da issue cita análise local, mas o texto geral “importar CSV” deixa essa fronteira ambígua.

Se S3 entrar no mesmo escopo, preservar **Automático** como padrão atual e permitir delimitador explícito por fonte, usado tanto na consulta quanto na importação. É preciso alcançar `S3ImportRequest`, `S3QueryRequest`, cada fonte de `S3CatalogQueryRequest`, modelos/configuração de fontes e chamadores. Alterar apenas o importador faria a consulta e a importação da mesma fonte discordarem.

O DuckDB aceita substituir o delimitador detectado com `delim`, conforme sua [documentação de autodetecção](https://duckdb.org/docs/lts/data/csv/auto_detection). O valor deve ser validado e escapado como literal SQL pelo mecanismo existente, especialmente se apóstrofo for aceito como delimitador. Não interpolar entrada livre sem escape nem mudar a autodetecção de outras propriedades do arquivo sem necessidade.

## Riscos e casos de borda

- **Falha silenciosa:** CSV separado por `;` pode ser lido como uma coluna sob vírgula. Escolher o delimitador errado continua podendo produzir um arquivo válido de uma coluna; não há garantia geral de detectar a intenção sem prévia/esquema esperado.
- **Inferência diferente da leitura:** aplicar o campo somente no `ReaderBuilder` pode inferir esquema incorreto antes de ler. Aplicar somente na inferência também quebra a leitura.
- **Escape incompleto:** trocar só `.join(",")` deixa valores com `;` ou Tab sem aspas. Cabeçalhos precisam do mesmo tratamento dos valores.
- **Byte versus caractere:** um caractere Unicode não equivale a um byte. Validar o tamanho UTF-8, e não apenas comprimento aparente ou número de caracteres.
- **Segurança de planilhas:** preservar a neutralização de prefixos de fórmula nos dois exportadores. O apóstrofo adicionado já altera textos perigosos; ida e volta desses campos não deve exigir igualdade com o texto original desprotegido.
- **Quantidade e ordem:** a grade e a consulta completa têm semânticas distintas. A escolha de delimitador não pode alterar quais registros/edições são exportados nem transformar exportação de grade em consulta completa.
- **Amostragem e tipos:** manter seleção integral/first-N/reservoir, tipos inferidos, nulls e serialização existente. Ponto e vírgula como separador não habilita automaticamente vírgula decimal ou formatação regional.
- **Arquivos vazios e só cabeçalho:** definir e testar o comportamento compatível com o atual. Se surgir defeito existente, registrá-lo e separar sua correção quando não for causada pela configuração do delimitador.
- **Falhas/cancelamento:** entrada inválida deve falhar antes de criar dataset ou substituir destino. Preservar rollback e limpeza dos temporários na exportação completa e importação.
- **Extensão:** CSV com tabulação continua usando `.csv` neste escopo. Suporte a `.tsv`, BOM, encoding, seleção de cabeçalho, quote/escape configuráveis e preferência regional são demandas separadas.

## Critérios de aceite propostos

1. Ambas as entradas de importação local permitem escolher o delimitador antes de iniciar; ausência do campo preserva vírgula.
2. CSV com vírgula, ponto e vírgula, Tab e personalizado `|` gera colunas, nomes e valores esperados, incluindo amostragem.
3. Todas as entradas de exportação usam a escolha em cabeçalhos e dados; grade mantém registros carregados/ordenação/edições e exportação completa mantém a consulta completa.
4. Valores/cabeçalhos com delimitador, aspas, CR/LF e campos vazios são serializados e lidos corretamente. Neutralização de fórmulas permanece ativa.
5. Delimitadores inválidos recebem mensagem clara na UI e erro nativo; não criam datasets nem sobrescrevem arquivos.
6. Cancelar escolha, configuração ou destino não executa a operação. Operações em andamento preservam comportamento atual de cancelamento.
7. Parquet/JSON/Arrow IPC mantêm o comportamento; opções CSV não aparecem nem são enviadas nesses fluxos.
8. Controles e mensagens funcionam em português/inglês e por teclado. Prévia, se vier a existir, usa a mesma configuração efetiva; uma prévia nova não é exigida.
9. O fechamento da issue declara se S3 está incluído; se incluído, consulta e importação respeitam a mesma configuração por fonte e o default continua Automático.

## Plano de verificação

- **Vitest de componentes:** adicionar casos de interação nos testes de `App`, `AnalysisWorkspace` e `ResultsGrid`: escolha/confirmar/cancelar, CSV versus outros formatos, saída da grade e encaminhamento da exportação completa. Os testes atuais de `AnalysisWorkspace` não exercitam a importação de arquivo ou exportação completa pela interface.
- **Contrato Tauri:** ampliar `analysis.test.ts` para o campo opcional e compatibilidade de chamadas sem campo. Manter os testes de `file-io`: a grade continua enviando conteúdo pronto.
- **Rust com arquivos reais:** parametrizar testes do motor para delimitadores, leitura/exportação/reimportação, cabeçalhos e valores com aspas/quebras de linha, seleção e validação. Verificar valores e esquema, não apenas quantidade de linhas. Testar payload antigo via deserialização e que rejeições preservam destino/datasets.
- **Fluxo desktop:** executar pelo menos um cenário UI → Tauri → Arrow/DuckDB com fixture CSV local e exportação completa. Vitest/jsdom e testes diretos do motor são evidências complementares, não substituem esse fluxo. S3, se incluído, exige fixture própria e integração do caminho remoto.
- **Checks após implementação:** typecheck, lint e testes afetados do desktop; `CARGO_BUILD_JOBS=2 cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` e testes nativos afetados. Não há justificativa para integração com todos os drivers de bancos nesta mudança local. Antes de push, seguir `docs/TESTING.md` e os gates do projeto.
- **Evidência de integração:** gerar comando, revisão/estado do checkout, versões, resultados/skips e logs automaticamente; sem dados ou segredos de produção.

## Limites desta avaliação

Esta entrega avalia a issue e propõe a implementação; não modifica comportamento do aplicativo nem publica comentários ou altera a issue. As capacidades do Arrow foram verificadas na versão instalada. Não foi executada integração nativa, S3 ou desktop completo durante a avaliação.

Os testes de frontend existentes foram acionados com `pnpm --filter desktop test src/components/ResultsGrid.test.tsx src/components/AnalysisWorkspace.test.tsx src/lib/analysis.test.ts src/lib/file-io.test.ts src/App.test.tsx`. O ambiente tem pnpm **11.17.0**, mas Node **26.8.1**, divergindo do Node 22 exigido pelo projeto; qualquer resultado desta execução não substitui a validação no runtime indicado.

Resultado: **5 arquivos e 95 testes passaram**, exit code 0, duração 119,69 s. Vitest 4.1.10; início registrado pelo runner às 08:15:40. Nenhum teste foi pulado nessa seleção. Trata-se de regressão do comportamento existente, sem testes novos para delimitadores. `git diff --check` também terminou com exit code 0; o relatório é um arquivo novo não rastreado. Não foram executados typecheck/lint/build porque não houve alteração de código ou configuração.

## Implementação aprovada

O diálogo compartilhado `CsvOptionsDialog.tsx` atende às duas entradas de importação local e às três entradas de exportação CSV. Preserva o visual Fluent UI, cores do produto e traduções inglês/português. Oferece vírgula, ponto e vírgula, Tab e personalizado; o default continua vírgula. Personalizado aceita um caractere ASCII imprimível diferente de aspas duplas ou Tab, com validação na interface e no Rust.

Depois de escolher um CSV local, o usuário vê seu nome, a escolha do delimitador e uma tabela com até 20 linhas. A alteração do delimitador atualiza a prévia com debounce de 250 ms e descarta respostas antigas. A prévia usa o mesmo formato/parser Arrow da importação, mas exibe valores como texto para preservar zeros à esquerda e não apresentar inferência parcial como definitiva. Aspas e quebras de linha são respeitadas. Uma coluna única recebe um aviso para conferir o separador; arquivos só com cabeçalho têm estado vazio próprio.

O novo comando Tauri `analysis_preview_csv` executa a leitura em uma tarefa de bloqueio fora da thread da interface. Não acessa o motor persistente nem cria datasets. Cada passagem de leitura é limitada a 1 MiB, com no máximo 1.024 colunas e 21 registros lidos para detectar a existência de mais linhas. Não lê o restante do arquivo para calcular um total. A prévia comunica falhas e permite tentar importar mesmo se não conseguir visualizar um registro muito grande; a importação efetiva continua validando o arquivo e protegendo a transação. Valores longos são abreviados apenas na tabela de prévia.

O seletor recebe foco inicial, Escape/cancelamento encerram a escolha e delimitadores inválidos desabilitam a confirmação. A tabela tem cabeçalhos acessíveis e região rolável por teclado. O diálogo mantém as ações visíveis no tamanho mínimo de janela (900 × 600), inclusive com 20 linhas. O contraste medido dos valores foi aproximadamente 15,6:1 no tema escuro e 17,5:1 no claro.

A exportação da grade parametriza escape e junção com o delimitador escolhido. As exportações completas configuram o writer Arrow; o delimitador também fica em `csvDelimiter` no arquivo de proveniência. A inferência e o reader de importação usam o mesmo `Format` configurado. Proteção contra fórmulas, tipos inferidos na importação, amostragem, ordem/edições da grade e publicação transacional da exportação completa permanecem preservadas. Parquet/JSON/Arrow IPC não oferecem nem recebem a opção pelos novos controles.

### Evidência da implementação

- Testes nativos: `CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib csv_ -- --nocapture` passou. O runner reportou 7 testes: **6 testes locais/CSV executados**, incluindo ida e volta de arquivos reais, validação que preserva destinos/datasets, prévia limitada e proteção de fórmulas; **1 teste S3 retornou antecipadamente** por ausência da opção de fixture. Isso não constitui integração S3.
- `CARGO_BUILD_JOBS=2 cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passou, em 56,98 s.
- A inspeção visual usou o componente real e os temas do produto em Edge/Chromium 155.0.4283.45, com dados sintéticos e IPC simulado. Foram inspecionados importação/exportação, temas claro/escuro, validação, Escape e seleção de Tab. Uma verificação adicional de comportamento conferiu 20 linhas e visibilidade da confirmação em 1280 × 800 e 900 × 600.
- Logs, capturas, comandos, versões, hashes do checkout/arquivos e resultados da rodada final de TypeScript ficam em `artifacts/csv-delimiters/verification-evidence.json`, `visual-evidence.json` e arquivos `.log`/`.png` adjacentes. A rodada final usa Node **22.23.1** e pnpm **11.17.0**.
- Resultado final: **111 testes em 7 arquivos passaram**, sem skips nessa seleção, com Vitest 4.1.10. Typecheck passou e lint terminou com **0 erros e 7 avisos preexistentes** em `AnalysisWorkspace`, `Editor` e `useSession`. `git diff --check` passou. A rodada inicial da implementação encontrou uma falha de simulação de foco/fechamento do modal em jsdom; a interação foi corrigida para reproduzir foco do seletor e aguardar o retorno da interface, e a rodada final passou por completo.

Os testes da interface/contrato usam Vitest/jsdom e IPC simulado; os testes nativos usam Arrow/DuckDB e arquivos reais temporários. **Não foi executado o E2E completo do aplicativo desktop com IPC Tauri e diálogo nativo de arquivos**, nem integração S3. Não houve push, release, comentário ou fechamento da issue.
