# Publicações do omni-sql

Atualizado em 07/10/2026, horário de Brasília. Documentação publicada no GitHub; LinkedIn, Reddit e DEV.to publicados. Show HN bloqueado pela restrição temporária do Hacker News. Textos em [OUTREACH.md](OUTREACH.md).

## Sequência

| Ordem | Data prevista | Canal | Material | Objetivo |
| --- | --- | --- | --- | --- |
| 1 | 05/10 | LinkedIn | Texto em português + pôster da demo | Receber relatos de analistas e desenvolvedores que trabalham com exportações |
| 2 | 05/10 | Reddit, r/SQL | Texto em inglês + link para exemplo reproduzível | Discutir o fluxo técnico e coletar dificuldades de uso |
| 3 | 05/10 | Show HN | Título + URL do repositório + comentário de apresentação | Apresentar o aplicativo baixável e responder perguntas técnicas |

A pedido do autor, os três posts serão publicados no mesmo dia, depois da
publicação dos materiais no GitHub. Isso reduz a capacidade de separar o efeito
de cada canal nas métricas. Reservar tempo para acompanhar as respostas.

## LinkedIn

Copiar o texto da seção **LinkedIn draft (Portuguese)** de OUTREACH.md.
Usar [local-analysis-poster.png](images/release-visuals/local-analysis-poster.png)
como imagem anexa. Ela mostra o resultado e o SQL da demonstração com dados
fictícios. O texto já distingue esse exemplo do uso principal: investigar um
CSV ou Parquet recebido de outra pessoa dentro da IDE.

O [GIF de 24 segundos](images/release-visuals/local-analysis-demo.gif) fica no
README. O [roteiro de vídeo](demo/README.md) é opcional e ainda precisa ser
gravado; não anunciar um vídeo contínuo como disponível.

## Reddit

Copiar título e corpo da seção **Reddit draft**. Usar um post de texto e declarar
que o projeto é do autor, como o rascunho já faz. Apresentar a ferramenta e o
fluxo de análise, mantendo o exemplo SQL disponível para reprodução.

As [regras consultadas de r/SQL](https://www.reddit.com/r/SQL/about/rules.json)
proíbem links a tutoriais básicos e pedem código legível quando incluído. O post
deve tratar do projeto e de seu uso, sem apresentá-lo como tutorial introdutório.
A ausência de uma proibição explícita de autopromoção não garante aceitação;
conferir também regras fixadas e avisos no formulário no dia da publicação.

Começar com uma comunidade. Outras comunidades ficam para uma adaptação posterior,
conforme pertinência e regras, sem copiar o mesmo anúncio para várias delas.

## Show HN

Usar o título da seção **Show HN draft** e a URL
https://github.com/cccadet/omni-sql. O corpo do rascunho serve como primeiro
comentário do autor, após submeter título e link.

As [diretrizes do Show HN](https://news.ycombinator.com/showhn.html) pedem algo
que as pessoas possam experimentar e que o autor esteja disponível para
discutir. Confirmar instaladores e exemplo público antes de postar. Informar os instaladores macOS 15+ (Apple Silicon e Intel), com assinatura ad-hoc e sem notarização. Não pedir votos ou comentários
a conhecidos.

## Pendências antes de publicar

- [x] README, guia, SQL/CSV, GIF e formulário publicados em `main`, commit `ae21685`.
- [x] Demo e formulário conferidos no GitHub; assets da release v0.7.1 disponíveis.
- [x] Registrar Traffic e downloads antes do primeiro post. Novo snapshot salvo
      localmente em docs/metrics/traffic-2026-10-04.json (fora do repositório público).
- [x] LinkedIn: perfil Cristian Carlos Dos Santos; Reddit: conta cccadet, r/SQL.
- [x] Hacker News: login confirmado, conta cccadet. Envio bloqueado pela restrição temporária de Show HNs.

## Depois de cada publicação

Registrar URL, data e canal abaixo. Anotar pedidos de plataforma, falhas de
instalação e relatos de importação/consulta concluída. Não usar clones como
contagem de instalações. Atualizar as métricas sete e quatorze dias depois,
conforme o procedimento em OUTREACH.md. Como as janelas se sobrepõem, os números
não isolam perfeitamente o efeito de cada canal.

| Canal | URL publicada | Data real | Retorno que exige ação |
| --- | --- | --- | --- |
| LinkedIn | https://www.linkedin.com/feed/update/urn:li:share:7512995039845777408/ | 05/10/2026 | Acompanhar respostas |
| Reddit | https://www.reddit.com/r/SQL/comments/1wylli0/querying_csv_and_parquet_exports_inside_a_sql_ide/ | 05/10/2026 | Acompanhar respostas |
| Show HN | Não publicado | Tentativa em 06/10/2026 | Restrição temporária: https://news.ycombinator.com/showlim |

## Estado da execução em 05/10

- GitHub: commit `ae21685` enviado para `main`, somente documentação, mídia e formulário. O gerador de imagens ficou fora do envio.
- Links locais, whitespace e YAML conferidos. Por orientação do autor, não executar validação de código para esta alteração documental. Não foi necessário reiniciar o WSL.
- LinkedIn: publicação concluída com pôster e texto alternativo.
- Reddit: publicação concluída em r/SQL com flair Discussion, conta cccadet.
- Show HN: envio tentado em 06/10/2026 pela conta cccadet. Hacker News redirecionou para https://news.ycombinator.com/showlim e restringiu o envio. Não publicado.

## DEV.to em 06/10/2026

Publicado: https://dev.to/cccadet/querying-csv-and-parquet-exports-inside-a-sql-ide-with-duckdb-4n7b

Adaptação do post de r/SQL, com GIF, exemplo SQL e tags sql, duckdb, opensource e database. Texto salvo em DEVTO-LOCAL-ANALYSIS.md.
