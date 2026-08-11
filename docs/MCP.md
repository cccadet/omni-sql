# Integração MCP local

Omni SQL fornece servidor MCP local via STDIO (padrão). O servidor conversa
somente com o backend autenticado em `127.0.0.1:41920`; não é um endpoint remoto
por padrão. Streamable HTTP é opt-in e escuta apenas em loopback.

## Capacidades e limites

As seis ferramentas expostas são:

1. `getActiveSql`: lê SQL da aba ativa.
2. `getActiveConnectionContext`: retorna contexto seguro da conexão ativa,
   sem senha ou credenciais.
3. `getSchemaSummary`: retorna schemas, relações e colunas da conexão ativa.
4. `getLatestSqlExecutionError`: retorna último erro de execução da aba ativa.
5. `openSqlTab`: abre uma aba com SQL fornecido; não executa SQL.
6. `proposeSqlEdit`: apresenta proposta de edição para aprovação explícita no
   desktop; rejeita estado obsoleto.

Não há ferramenta para executar SQL, ler conexões arbitrárias, acessar senhas,
tokens, strings de conexão, arquivos, shell ou processos. SQL, nomes de schema,
metadados e resultados permitidos retornados pelas ferramentas ficam visíveis ao
cliente MCP local conectado; use a integração somente quando essa exposição for
aceitável.

O backend mantém autenticação separada para MCP, bind em loopback, requests e
respostas limitados, allowlists por ferramenta e fila limitada. O descritor de
runtime contém uma capacidade temporária da execução atual: não abra, copie ou
cole seu conteúdo.

## Streamable HTTP e Secure MCP Tunnel

Para habilitar:

```bash
OMNI_SQL_MCP_HTTP_TOKEN='<segredo separado>' \
  node dist/index.js '<descritor>' --transport streamable-http
```

`OMNI_SQL_MCP_HTTP_TOKEN` autentica entrada HTTP. Não reutilize token do
descritor: ele autentica ponte local com backend. Host CLI/env não-loopback é
rejeitado; sessões têm limite pequeno e expiram por inatividade.

Secure MCP Tunnel deve ser único limite público: fornecer HTTPS/autenticação
pública, injetar `Authorization: Bearer <OMNI_SQL_MCP_HTTP_TOKEN>` no upstream e
nunca expor segredo. Encaminhar para `http://127.0.0.1:41922/mcp` preservando
métodos `POST`, `GET`, `DELETE`, headers `Mcp-Session-Id`,
`Mcp-Protocol-Version`, `Last-Event-ID`, `Accept` e `Content-Type`, além de
SSE/chunked streaming sem buffering ou reescrita. Não adicionar OAuth aqui;
tunnel possui HTTPS/auth pública. Headers `Host`/`Origin` encaminhados podem ser
do domínio público do tunnel; listener valida apenas formato e exige bearer.

## Inicialização e launcher real

1. Inicie o Omni SQL. O menu de status MCP não fornece configuração válida antes
   de o backend estar pronto.
2. Em desenvolvimento, construa o servidor se necessário:

   ```bash
   pnpm --filter @omni-sql/mcp-server build
   ```

3. Abra o menu de status MCP no IDE e copie os campos gerados `command` e
   `args`.

O contrato retornado pelo comando nativo do IDE é exatamente este objeto; os
 valores abaixo são placeholders, não configuração para colar:

```json
{
  "command": "<valor absoluto gerado pelo IDE>",
  "args": [
    "<args[0] absoluto: entrada do servidor MCP>",
    "<args[1] absoluto: descritor de runtime>"
  ]
}
```

`command` aponta para o Node escolhido pelo runtime (Node local absoluto em
desenvolvimento, Node empacotado em release). `args[0]` aponta para o JavaScript
MCP (build do workspace em desenvolvimento, recurso empacotado em release).
`args[1]` aponta para o descritor temporário da execução. Não há `cwd` no
contrato; não adicione um. Não substitua caminhos, ordem dos argumentos ou
valores gerados por exemplos fixos.

O descritor e a configuração deixam de estar disponíveis quando Omni SQL
encerra. Reinicie o IDE e copie uma nova configuração depois de cada execução.

## Configuração do Codex

Inicie Omni SQL, copie a configuração do menu de status MCP e use exatamente os
campos gerados. Em TOML, a tradução conceitual é:

```toml
[mcp_servers.omni_sql]
command = "<command copiado do IDE>"
args = ["<args[0] copiado do IDE>", "<args[1] copiado do IDE>"]
```

Alternativa pela CLI, usando exatamente o comando e os argumentos gerados:

```bash
codex mcp add omni-sql -- "<command copiado>" \
  "<args[0] copiado>" "<args[1] copiado>"
codex mcp list
```

Use os campos copiados do menu, não valores inventados. Não cole tokens, senhas,
strings de conexão ou conteúdo do descritor.

Referência: [Codex — MCP](https://developers.openai.com/codex/extend/mcp).

## Configuração do Claude Desktop

Inicie Omni SQL e copie os campos gerados `command` e `args` no menu de status
MCP da UI. No Claude Desktop, abra **Settings > Developer > Edit Config** e
adicione esta entrada ao JSON:

```json
{
  "mcpServers": {
    "omni-sql": {
      "command": "<command copiado da UI do Omni SQL>",
      "args": ["<args[0] copiado>", "<args[1] copiado>"]
    }
  }
}
```

Se arquivo já tiver `mcpServers`, mescle `omni-sql` dentro desse objeto; não crie
uma segunda chave `mcpServers`. No Windows, cada barra invertida em caminho JSON
deve ser escrita duas vezes (`\\`). Salve, encerre completamente Claude Desktop
e abra-o novamente. Em **Connectors**, Omni SQL deve aparecer como **Running**.
Se não aparecer, consulte **Developer logs** para erro de launcher ou caminho.
Gere e copie sempre valores atuais da UI. Nunca copie ou exponha conteúdo do
descritor de runtime, token do descritor, token HTTP ou qualquer segredo; apenas
campos gerados do launcher entram na configuração.

## ChatGPT Desktop versus navegador

Codex e ChatGPT Desktop podem iniciar este servidor STDIO local. No ChatGPT
Desktop, use a tela de configuração de apps/conectores disponível na versão
instalada; a UI pode variar. Escolha **STDIO** e copie diretamente:

- **Command:** campo `command` gerado.
- **Arguments:** array `args` gerado, sem alterar ordem.
- **Working directory:** não é necessário; use somente `command` e `args` gerados.

Copie a configuração gerada pelo menu de status depois de iniciar Omni SQL;
valores reais variam entre desenvolvimento e release. Não cole tokens, senhas,
strings de conexão ou conteúdo do descritor. ChatGPT no navegador não consegue
conectar a um servidor STDIO local; ele exige uma integração remota via HTTPS,
fora deste recurso. Consulte
[Apps SDK — conectar ao ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt).

## Verificação

```bash
pnpm verify
```

Além do comando acima, valide manualmente: Omni SQL iniciado antes do launcher,
configuração gerada pelo menu, inicialização STDIO, listagem das seis
ferramentas e aprovação de proposta de edição no desktop.
