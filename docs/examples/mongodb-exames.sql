-- Ajuste o banco, a coleção e a guia para seus dados.
-- As consultas são somente leitura. Cada consulta deve ser executada separadamente.

-- 1. Um exame por linha, com o primeiro código. Esperado: códigos completos, nunca '['.
WITH itens AS (
    SELECT _id, data_evento, unnest(exames) AS exame
    FROM base_laudos.padronizacao
    WHERE list_contains(id_guia, '52712827')
)
SELECT _id, data_evento,
       exame.codigos[1] AS codigo,
       exame.nome_padronizado AS descricao
FROM itens;

-- 2. A igualdade da guia usa a busca nativa Mongo, inclusive quando id_guia é um array.
WITH itens AS (
    SELECT _id, data_evento, unnest(exames) AS exame
    FROM base_laudos.padronizacao
    WHERE id_guia = '52712827'
)
SELECT _id, data_evento,
       exame.codigos[1] AS codigo,
       exame.nome_padronizado AS descricao
FROM itens;

-- 3. Todos os códigos: um exame pode gerar mais de uma linha.
WITH itens AS (
    SELECT _id, data_evento, unnest(exames) AS exame
    FROM base_laudos.padronizacao
    WHERE id_guia = '52712827'
), codigos AS (
    SELECT _id, data_evento,
           unnest(exame.codigos) AS codigo,
           exame.nome_padronizado AS descricao
    FROM itens
)
SELECT * FROM codigos ORDER BY codigo;

-- 4. Filtra o código depois de expandir os exames; a guia continua filtrada no Mongo.
WITH itens AS (
    SELECT _id, data_evento, unnest(exames) AS exame
    FROM base_laudos.padronizacao
    WHERE id_guia = '52712827'
)
SELECT _id, data_evento,
       exame.codigos[1] AS codigo,
       exame.nome_padronizado AS descricao
FROM itens
WHERE list_contains(exame.codigos, '40302040');

-- 5. Conta todos os exames da guia, independentemente do limite de prévia da interface.
WITH itens AS (
    SELECT unnest(exames) AS exame
    FROM base_laudos.padronizacao
    WHERE id_guia = '52712827'
)
SELECT count(*) AS quantidade_exames FROM itens;

-- 6. Ordena todos os exames encontrados e limita somente o resultado final.
WITH itens AS (
    SELECT _id, data_evento, unnest(exames) AS exame
    FROM base_laudos.padronizacao
    WHERE id_guia = '52712827'
)
SELECT _id, exame.codigos[1] AS codigo,
       exame.nome_padronizado AS descricao
FROM itens
ORDER BY descricao, codigo
LIMIT 1;

-- 7. Guia inexistente: retorna zero linhas, preservando as colunas quando há amostra de esquema.
WITH itens AS (
    SELECT _id, data_evento, unnest(exames) AS exame
    FROM base_laudos.padronizacao
    WHERE id_guia = '__guia_inexistente__'
)
SELECT _id, data_evento, exame.codigos[1] AS codigo,
       exame.nome_padronizado AS descricao
FROM itens;

-- Para inspecionar o caminho combinado, use Explain na interface para a consulta 1 ou 2.
-- O plano inclui mongo_native (procure IXSCAN se existe índice em id_guia),
-- mongo_source_documents e o plano DuckDB sobre __omni_mongo_source.
