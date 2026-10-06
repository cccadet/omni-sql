# Plano de correção de segurança

Data: 2026-10-06. Base analisada: `cb61b39f81ce844785500b9fe3d6becee1afff5f`.
Scan Codex Security: `c4533d6f-a9fe-4bfa-ad61-8ad898efadd4`.

Este plano inicial cobre quatro achados validados por análise estática e duas
investigações pendentes. Na elaboração inicial não foram executados ataques, testes de reprodução
ou alterações de implementação. A execução autorizada e seus resultados estão
registrados em `SECURITY_REMEDIATION_RESULTS.md`. A classificação foi alta para o desvio de
execução PostgreSQL e baixa para os outros três achados.

## Ordem de implementação

### 1. PostgreSQL: impedir execução pelo caminho de planejamento

Prioridade imediata. Corrigir o consumidor compartilhado em
`packages/adapters-pg/src/pg-adapter.ts`, usado por `query.explain` e
`query.diagnose`, incluindo chamadas originadas no MCP e no editor.

- Exigir uma única instrução no protocolo de execução PostgreSQL, usando um
  recurso já disponível no driver. Confirmar sua API na documentação atual
  antes de implementar; não confiar exclusivamente no lexer.
- Fazer o planejamento em transação explicitamente somente leitura, sem
  `ANALYZE`, com rollback garantido. Não permitir que comandos adicionais
  encerrem a transação protetora: a restrição de instrução única é obrigatória.
- Garantir a liberação da conexão; descartar uma conexão cujo rollback ou
  restauração de estado falhe.
- Corrigir o tratamento de strings PostgreSQL `E'…'` no lexer e no divisor
  de instruções do frontend. Revisar dollar quoting e comentários aninhados
  para evitar divergências semelhantes. Não transformar o lexer tolerante
  em um parser de segurança.
- Revisar os outros consumidores de `validateQuery`/`explain` por mecanismo
  equivalente; alterar outros adapters somente se houver falha concreta.

Aceitação: o payload de escape-string identificado no scan não modifica uma
tabela sentinela pelo MCP `explainSql` nem por diagnósticos automáticos ao
abrir/editar SQL. Consultas SELECT/CTE válidas continuam produzindo planos;
uma falha não deixa a conexão presa ou com transação aberta. Validar com
PostgreSQL real, além da regressão de separação/tokenização.

### 2. HTTP: conter falhas antes da autenticação

Corrigir `packages/backend/src/index.ts` no ingresso compartilhado.
O construtor de URL está na linha 388 da base analisada; a referência 400
no relatório selado está deslocada.

- Rejeitar destinos de requisição inválidos com HTTP 400, sem exceção escapar.
- Capturar rejeições do callback HTTP inteiro, preservando o comportamento
  de autenticação e as respostas das rotas existentes.
- Tratar falhas depois de headers enviados sem tentar emitir uma segunda
  resposta; finalizar a conexão quando necessário.

Aceitação: uma requisição raw com destino inválido não encerra o processo;
uma requisição válida posterior continua funcionando. Fazer a regressão em
processo filho isolado para detectar encerramento real do backend.

### 3. Reservoir: aplicar limite durante a retenção

Corrigir as duas implementações em
`apps/desktop/src-tauri/src/data_engine.rs`: importação Arrow de arquivo e
importação de stream de banco.

- Contabilizar bytes retidos a cada inserção/substituição e descontar o
  tamanho da entrada removida. Checar antes de reter/copiar a nova entrada.
- Para Arrow, decidir se a linha será selecionada antes de compactá-la;
  evitar alocação de linhas descartadas e considerar o pico durante a troca.
- Usar um limite fixo explícito para memória da amostra, separado do teto
  de 4 GiB de dados persistidos. Definir o valor a partir do envelope existente
  e de uma medição focada; não adicionar configuração de UI nesta correção.
- Preservar amostragem com semente, cancelamento, rollback e ausência de
  publicação de dataset parcial em caso de rejeição.

Aceitação: regressões com orçamento pequeno comprovam rejeição antes de
reter bytes acima do limite nos dois caminhos, incluindo substituição.
Um ensaio isolado com células largas confirma consumo limitado e recuperação
para a próxima importação; não gerar dezenas de GiB para testar a falha.

### 4. CSV: alinhar proteção da exportação completa

Corrigir o exportador nativo em `data_engine.rs` e seus consumidores no
frontend. A grade já neutraliza prefixos de fórmula em `ResultsGrid.tsx`.

- Reutilizar a mesma política na exportação CSV completa, incluindo cabeçalhos
  e campos textuais. Não converter números reais em texto indiscriminadamente.
- Adotar exportação segura para planilhas como padrão. Se a fidelidade exata
  do CSV bruto precisar ser preservada, oferecê-la como escolha explícita,
  com descrição curta do efeito ao abrir em planilhas.
- Manter streaming, cancelamento e publicação atômica do arquivo/proveniência.
  Não alterar Parquet/Arrow ou os dados armazenados no dataset.

Aceitação: valores e cabeçalhos com prefixos de fórmula são exportados como
texto no modo seguro. Aspas, vírgulas e quebras de linha continuam corretas;
o modo bruto, se mantido, preserva os valores originais. Validar um arquivo
pequeno na planilha suportada, sem fórmulas que façam requisições externas.

## Investigações pendentes

### Metadados e atualização de uma linha

O scan observou chaves `${schema}.${table}` que podem colidir e uma checagem
de quantidade afetada depois do UPDATE. Ainda não estabeleceu a cadeia
completa de exploração pelo frontend.

Reproduzir em PostgreSQL isolado a combinação schema `a`/tabela `b.c` e
schema `a.b`/tabela `c`, verificando cache, PK e habilitação de edição.
Se confirmada, substituir a chave ambígua por representação de tupla/nested
map nos pontos afetados. Garantir que uma mutação de linha só seja confirmada
depois de verificar exatamente uma linha dentro da mesma transação. Revisar
cada adapter afetado sem ampliar esta tarefa para reescrever introspecção.

Aceitação: relações distintas nunca compartilham metadados; uma atualização
que afetaria várias linhas deixa todas inalteradas. Promover para correção
obrigatória somente após confirmar o comportamento e seu impacto.

### Privacidade do armazenamento analítico persistente

Verificar Linux/macOS sem `LOCALAPPDATA`/`XDG_DATA_HOME`: o código escolhe
diretório temporário previsível para `local.duckdb`. Inspecionar permissões
reais do diretório, banco e arquivos auxiliares; não assumir os modos do DuckDB.

Se houver acesso indevido ou risco de compartilhamento entre usuários,
usar o diretório de dados do aplicativo fornecido pelo Tauri e proteger os
arquivos conforme a plataforma. Planejar migração que preserve datasets:
não apagar o banco antigo, não seguir caminhos controlados por outro usuário
e não substituir um banco novo existente silenciosamente.

Aceitação: dados ficam no diretório correto e inacessíveis a outro usuário
sem autorização; upgrade preserva os dados e permite recuperação.

## Entrega e verificação

Implementar quatro mudanças coerentes, na ordem acima, com regressões nos
caminhos reais. Investigações pendentes podem virar mudanças adicionais
após confirmação. Não criar dependências, serviços ou nova arquitetura para
estas correções locais.

Ao concluir cada mudança, rodar typecheck, lint e testes locais dos pacotes
afetados uma vez; conferir consumidores quando contratos mudarem. Para Rust,
usar `CARGO_BUILD_JOBS=2` nas verificações e testes. Exercitar PostgreSQL real
para planejamento e eventual mutação/transação; exportação e importação
exigem validação nativa do caminho afetado.

Antes de push de código concluído, executar `pnpm verify:push` e respeitar
o checkpoint existente. Antes de release, executar `pnpm verify:release`
conforme as instruções do projeto. Não substituir essas etapas por cobertura
TypeScript isolada. Uma release contendo apenas correções incrementa patch;
definir a versão a partir da versão vigente na entrega, preservando tags.

O encerramento exige revalidar os quatro caminhos originais, registrar
resultado e limitações, e atualizar o status dos achados. Testes aprovados
ou aplicação de um patch, sozinhos, não comprovam remediação do achado.
