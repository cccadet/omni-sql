# Remediação de segurança

Escopo autorizado: quatro achados do scan `c4533d6f-a9fe-4bfa-ad61-8ad898efadd4`
e duas investigações do plano. Entrega para integração na `main`; sem release.

Resultado: `fixed` nos caminhos verificados, com os limites de ambiente
registrados ao final.

## Alterações

- **Planejamento PostgreSQL:** `explain` e `validateQuery` usam a mesma transação
  `BEGIN READ ONLY`, protocolo estendido que aceita apenas uma instrução e
  rollback ao finalizar. Falha no rollback descarta a conexão. Lexer e editor
  reconhecem escape strings; dollar quoting respeita limites de identificador.
  Comentários aninhados no editor seguem o dialeto, incluindo extração de variáveis.
- **Ingresso HTTP:** destino inválido recebe 400; rejeições do handler inteiro
  são capturadas. Se os headers já foram enviados, a conexão é encerrada.
- **Amostragem:** stream e arquivo contabilizam memória retida durante inserção
  e substituição, com limite de 32 MiB separado do orçamento persistido de 4 GiB.
  A seleção Arrow ocorre antes de copiar; o limite considera o pico da troca.
  Frames/batches de entrada e DuckDB têm seus próprios limites: 32 MiB não é
  uma promessa de limite total de RSS do processo.
- **CSV completo:** cabeçalhos e strings, incluindo dicionários Arrow/ENUM,
  recebem apóstrofo para os prefixos de fórmula cobertos pela política da grade.
  Valores numéricos continuam numéricos; Parquet e dados armazenados não mudam.
  A interface informa a proteção. CSV bruto não ganhou um novo modo nesta correção.
- **Metadados e UPDATE:** reprodução PostgreSQL confirmou PK contaminada pela
  colisão de schema/tabela. Quatro adapters usam chaves de tupla. PostgreSQL,
  MySQL, SQL Server e Oracle só confirmam UPDATE quando exatamente uma linha
  é atingida. MySQL mantém lock de metadados e recusa engines não transacionais;
  SQL Server conta o OUTPUT do UPDATE, sem confundir contagens de triggers.
- **Armazenamento:** banco no diretório de dados Tauri; diretórios Unix 0700 e
  banco 0600. Temporários analíticos também ficam privados por usuário. Migração
  valida ownership e symlinks, recupera/checkpointa WAL sob lock DuckDB, preserva
  o banco antigo e publica sem sobrescrever destino existente. Dados legados
  de outro usuário são deixados intactos e não impedem criar o banco privado.

## Regressões adicionadas

- Processo filho recebe requisição raw inválida e permanece respondendo.
- PostgreSQL real: MCP explain, diagnósticos, payload E-string e COMMIT adicional,
  tabela sentinela intacta, SELECT/CTE válido, metadados distintos e rollback.
- MySQL/SQL Server/Oracle reais: múltiplas correspondências revertidas e uma
  correspondência confirmada; MyISAM recusado e trigger SQL Server coberto.
- Rust: orçamento pequeno e overflow, linhas largas nos dois caminhos de importação,
  rollback/recuperação, CSV com cabeçalho/fórmula/ENUM/aspas/newline/nulos/número
  negativo, permissões e preservação do banco legado.

## Validação final

1. **Tipos e lint:** `pnpm -r typecheck` e `pnpm -r lint` aprovados.
   Lint manteve oito avisos preexistentes, sem erros. `git diff --check` aprovado.
2. **Gatilhos e controles legítimos:** regressão PostgreSQL real passou pelo
   bridge MCP e pelos diagnósticos, com os dois payloads mantendo a sentinela
   intacta. CTE/SELECT válido continuou gerando plano. HTTP raw inválido recebeu
   400 e o mesmo processo respondeu à próxima requisição autenticada.
   Os três testes reais de UPDATE em MySQL, SQL Server e Oracle passaram,
   incluindo rollback, edição única, MyISAM e contagem com trigger.
3. **Suítes locais:** `pnpm -r test` aprovado: 38 arquivos/228 testes frontend
   e 273 testes dos pacotes/backend. Onze casos condicionais ficaram ignorados
   nessa execução; as quatro regressões de segurança com bancos reais foram
   executadas separadamente, sem skips.
4. **Rust:** `CARGO_BUILD_JOBS=2 cargo test --offline --manifest-path
   apps/desktop/src-tauri/Cargo.toml --lib -- --nocapture` aprovado após o
   último ajuste de recuperação da migração: 64 testes, zero falhas e três
   benchmarks ignorados por configuração.
5. **Memória:** execução isolada do teste de importações largas, pelo binário
   de testes e `/usr/bin/time -v`, passou: RSS máximo 144.796 KiB (cerca de
   141 MiB), sem swaps. Isso mede esse ensaio, não limita todo uso do aplicativo.

O ensaio de persistência mediu modo 0644 na criação original do DuckDB e
comprovou diretório 0700/banco 0600 na versão corrigida, preservando a sentinela
migrada e o banco legado. A regressão também cobre destino já existente e
arquivo temporário de migração abandonado, sem sobrescrita ou remoção.

Falhas intermediárias nas fixtures (schema obrigatório, propriedade readonly,
localização de helpers Rust e serverName TLS) foram corrigidas e reexecutadas.
A revisão independente identificou os casos MyISAM, trigger SQL Server,
comentário por dialeto e legado pertencente a outro usuário; foram tratados.

## Limites da verificação

- Verificação executada em Linux; não houve teste de inicialização em Windows/macOS.
- Não há aplicativo de planilha instalado neste ambiente. O CSV foi validado
  pelo exportador real e por regressões de serialização; abertura em Excel ou
  LibreOffice não foi executada. A política neutraliza os prefixos específicos
  já adotados na grade, sem afirmar proteção universal de todas as planilhas.
- O gate adicional `pnpm verify:push` passou para esta integração, incluindo
  TypeScript, Rust, JVM e fixtures S3 isoladas: 80,7% de cobertura de código novo
  frente ao mínimo de 80%, com baseline Sonar
  `d3cbd445f875d74827937ec0711bb245e2e4c9fe`.
  Esse preflight é estimativa local; CI/SonarCloud confirmam o gate definitivo.
  `verify:release` não foi executado porque não há pedido de release.
- Nenhum relatório selado do scan foi alterado. O estado desta remediação
  fica registrado aqui; não houve criação de release nem fechamento de tickets.
