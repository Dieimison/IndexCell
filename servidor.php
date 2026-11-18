<?php
/**
 * Servidor local - Assistência Técnica Index Celulares
 *
 * Este arquivo é o "roteador" do servidor embutido do PHP.
 * Não precisa instalar Apache, XAMPP nem nada: basta ter o PHP.
 *
 * Como rodar:
 *     php -S localhost:5500 servidor.php
 *
 * Ou simplesmente dê dois cliques em  iniciar-servidor.bat
 *
 * O que ele faz:
 *   - abre a tela de login quando você acessa a raiz (/)
 *   - responde a API (tudo que começa com /api) usando o api/api.php
 *   - entrega os arquivos das telas: SÓ o que está em Login\, Dashboard\,
 *     Img\ e Loja\ (a loja online, v8), e só os tipos de arquivo de tela
 *     (html, css, js, imagem); /loja leva para a vitrine
 *   - qualquer outra coisa é 404: o banco (dados\), as cópias de
 *     segurança, LEIA-ME.txt, memory.md, os .bat e este arquivo
 *
 * Por que lista do que PODE, e não do que não pode: a trava antiga
 * olhava a URL crua ("começa com /dados?") e /foo/../dados/index.sqlite,
 * /./dados/... e /Img/..%2fdados/... passavam por ela e entregavam o
 * banco inteiro. Agora a conferência é feita no caminho JÁ RESOLVIDO
 * (realpath), e quem entrega o arquivo é este roteador - o arquivo
 * conferido é exatamente o arquivo enviado.
 */

const PAGINA_INICIAL = '/Login/index.html';

/* As únicas pastas servidas, e os únicos tipos de arquivo. */
const PASTAS_PUBLICAS = ['Login', 'Dashboard', 'Img', 'Loja'];
const TIPOS_PUBLICOS  = [
    'html'  => 'text/html; charset=utf-8',
    'css'   => 'text/css; charset=utf-8',
    'js'    => 'text/javascript; charset=utf-8',
    'jpeg'  => 'image/jpeg',
    'jpg'   => 'image/jpeg',
    'png'   => 'image/png',
    'gif'   => 'image/gif',
    'svg'   => 'image/svg+xml',
    'ico'   => 'image/x-icon',
    'webp'  => 'image/webp',
    'woff'  => 'font/woff',
    'woff2' => 'font/woff2',
];

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$uri = rawurldecode((string) ($uri ?? '/'));

// Raiz do site -> vai direto para a tela de login
if ($uri === '' || $uri === '/') {
    header('Location: ' . PAGINA_INICIAL);
    exit;
}
// Endereco curto da loja online (o que se passa para o cliente).
if (preg_match('#^/loja/?$#i', $uri)) {
    header('Location: /Loja/index.html');
    exit;
}

// API: tudo que começa com /api é respondido pelo api/api.php
if (preg_match('#^/api(/|$)#i', $uri)) {
    require __DIR__ . '/api/api.php';
    tratarApi($uri);
    exit;
}

$destino = arquivoPublico($uri);
if ($destino === null) {
    http_response_code(404);
    pagina_erro(404, 'Página não encontrada', $uri);
    exit;
}

header('Content-Type: ' . TIPOS_PUBLICOS[strtolower(pathinfo($destino, PATHINFO_EXTENSION))]);
header('Content-Length: ' . filesize($destino));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-cache');
if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
    readfile($destino);
}
exit;

/**
 * Devolve o caminho real do arquivo pedido se ele puder ser servido, ou
 * null. A conferência é feita DEPOIS do realpath, que já resolveu "..",
 * ".", barras dobradas, maiúsculas e nomes curtos do Windows.
 */
function arquivoPublico(string $uri): ?string
{
    if (strpos($uri, "\0") !== false) {
        return null;
    }
    $raiz = realpath(__DIR__);
    $destino = realpath($raiz . DIRECTORY_SEPARATOR . ltrim($uri, '/\\'));
    if ($destino === false || !is_file($destino)) {
        return null;
    }

    $dentro = false;
    foreach (PASTAS_PUBLICAS as $pasta) {
        $base = realpath($raiz . DIRECTORY_SEPARATOR . $pasta);
        if ($base === false) {
            continue;
        }
        // O separador no fim impede que "Img" libere uma "Img-backup" vizinha.
        $base .= DIRECTORY_SEPARATOR;
        $comeca = PHP_OS_FAMILY === 'Windows'
            ? strncasecmp($destino, $base, strlen($base)) === 0
            : strncmp($destino, $base, strlen($base)) === 0;
        if ($comeca) {
            $dentro = true;
            break;
        }
    }
    if (!$dentro) {
        return null;
    }

    $extensao = strtolower(pathinfo($destino, PATHINFO_EXTENSION));
    return isset(TIPOS_PUBLICOS[$extensao]) ? $destino : null;
}

function pagina_erro(int $codigo, string $titulo, string $caminho): void
{
    // O caminho volta para a tela escapado: senão /<script>... virava
    // código rodando no navegador de quem clicou num link maldoso.
    $caminho = htmlspecialchars($caminho, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    header('Content-Type: text/html; charset=utf-8');
    echo <<<HTML
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>{$codigo} - {$titulo}</title>
        <style>
            body {
                background: #181c29;
                color: #e0e0e0;
                font-family: 'Segoe UI', Arial, sans-serif;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                text-align: center;
            }
            h1 { color: #20a0ff; font-size: 64px; margin: 0; }
            p  { margin: 10px 0; }
            code {
                background: rgba(255,255,255,0.07);
                padding: 4px 10px;
                border-radius: 6px;
            }
            a {
                color: #20a0ff;
                margin-top: 25px;
                text-decoration: none;
                border: 1px solid rgba(32,160,255,0.4);
                padding: 12px 25px;
                border-radius: 8px;
            }
            a:hover { background: rgba(32,160,255,0.1); }
        </style>
    </head>
    <body>
        <h1>{$codigo}</h1>
        <p>{$titulo}</p>
        <p><code>{$caminho}</code></p>
        <a href="/Login/index.html">Voltar para o login</a>
    </body>
    </html>
    HTML;
}
