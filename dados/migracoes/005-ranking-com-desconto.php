<?php
/**
 * Passo 005 (v4 -> v5):
 *   - vw_itens_faturados: o ranking "o que mais vendeu" passa a contar a
 *     receita do item com o desconto do documento repartido (antes somava
 *     o preco cheio). So muda view: nenhuma tabela e nenhum dado. A view
 *     o aplicar-estrutura refaz do estrutura.sql; este passo existe para
 *     a versao subir e o banco v4 nao ser lido com a view antiga.
 */

declare(strict_types=1);

return function (PDO $pdo): array {
    return ['view vw_itens_faturados refeita (ranking com desconto)'];
};
