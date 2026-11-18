<?php
/**
 * api/nucleo.php - o que a API e o instalador (dados/aplicar-estrutura.php)
 * usam igual: versao do banco, regras com numero, dominios (status,
 * categorias, motivos) com rotulo, abertura do banco, senha, validacao do
 * corpo e sessao.
 *
 * So DEFINE constantes e funcoes: incluir este arquivo nao abre banco,
 * nao le requisicao e nao muda configuracao do PHP. E por isso que o
 * instalador pode inclui-lo sem carregar a API inteira.
 */

declare(strict_types=1);

// ------------------------------------------------------------------
// Versao e regras com numero (a tela recebe tudo por GET /api/config)
// ------------------------------------------------------------------
const VERSAO_BANCO = 8;       // PRAGMA user_version; dados/migracoes/NNN-*.php levam ate aqui
const ITERACOES    = 120000;     // PBKDF2

const SENHA_MIN           = 8;
const PARCELAS_MAX        = 24;
const VALOR_MAXIMO        = 10000000.00;   // R$ 10 milhoes: acima disso e dedo escorregando
const QUANTIDADE_MAXIMA   = 100000;
const ESTOQUE_BAIXO       = 3;
const GARANTIA_PADRAO     = 90;            // dias; o DEFAULT de ordens_servico.garantia_dias e o mesmo numero
const GARANTIA_MAXIMA     = 3650;          // dias (10 anos)
const TEMPO_MEDIO_MAXIMO  = 100000;        // minutos, no cadastro de servico
const JANELA_VENCIMENTOS  = 90;            // dias de contas a vencer no dashboard
const TOLERANCIA_CENTAVO  = 0.01;          // 33,33 x 3 = 99,99 fecha com 100,00
const SESSAO_SEGUNDOS     = 8 * 3600;      // 28800: a "sessao de 8 horas"
const LOGIN_MAX_ERROS     = 5;             // por login
const LOGIN_MAX_ERROS_IP  = 30;            // por IP, so quando o IP NAO e local
const LOGIN_AVISO_A_PARTIR = 3;            // a partir deste erro, a resposta diz quantas restam
const LOGIN_BLOQUEIO_MIN  = 15;

const REGRA_SENHA = 'Pelo menos ' . SENHA_MIN . ' caracteres, com letras e números. Não pode conter o login, '
                  . 'nem ser uma senha comum, nem uma repetição (como "senhasenha" ou "12121212").';

/*
 * Senhas que caem no primeiro chute. Conferidas sem acento e sem caixa.
 * Quem entra com uma delas e obrigado a trocar antes de usar o sistema.
 */
const SENHAS_COMUNS = [
    'admin', 'administrador', 'senha', 'password', 'qwerty', 'iloveyou', 'index', 'celular', 'loja',
    '1234', '12345', '123456', '1234567', '12345678', '123456789', '1234567890', '123123', '0000',
    '00000000', '11111111', '87654321', '2023', '2024', '2025', '2026',
    'senha123', 'senha1234', 'senha12345', 'senha2024', 'senha2025', 'senha2026', 'minhasenha1',
    'admin123', 'admin1234', 'admin2024', 'admin2025', 'admin2026', 'abc12345', 'abcd1234',
    'abc123456', 'qwerty123', 'qwerty12', 'password1', 'password123', 'passw0rd', 'mudar123',
    'mudar1234', 'trocar123', 'trocar1234', 'teste123', 'teste1234', 'celular1', 'celular123',
    'index123', 'index1234', 'loja1234', 'loja12345', 'brasil123', 'brasil2026', 'flamengo1',
    'corinthians1', 'palmeiras1', 'gremio123', 'internacional1', 'iphone123', 'samsung123',
    'xiaomi123', 'motorola1', 'assistencia1', 'tecnico123', 'balcao123', 'q1w2e3r4', '1q2w3e4r',
    'a1b2c3d4', 'aa123456', 'abc123abc', 'admin@123', 'senha@123', 'p@ssw0rd',
];

/*
 * Dominios: o valor gravado e o rotulo que a tela mostra, num lugar so.
 * A tela recebe por /api/config.dominios; o PHP usa os valores para
 * validar e os rotulos nas mensagens e na ficha do item. Antes cada lado
 * tinha a sua copia ("Devolvido" aqui, "Devolvida" la).
 */
const DOMINIOS = [
    'status_os' => [
        'aberta' => 'Aberta', 'orcamento' => 'Orçamento', 'aprovada' => 'Aprovada',
        'em_reparo' => 'Em reparo', 'pronta' => 'Pronta', 'entregue' => 'Entregue',
        'recusada' => 'Recusada', 'cancelada' => 'Cancelada',
    ],
    'status_venda' => ['concluida' => 'Concluída', 'cancelada' => 'Cancelada'],
    'status_lancamento' => ['pendente' => 'Pendente', 'pago' => 'Pago', 'cancelado' => 'Cancelado'],
    'tipos_lancamento' => ['receber' => 'A receber', 'pagar' => 'A pagar'],
    'tipos_entrada' => ['celular' => 'Celular', 'peca' => 'Peça', 'produto' => 'Produto'],
    'situacoes' => ['ready' => 'Pronto para venda', 'processamento' => 'Em processamento',
                    'check' => 'Em conferência', 'vendido' => 'Vendido'],
    'categorias_peca' => [
        'tela' => 'Tela', 'bateria' => 'Bateria', 'placa_carga' => 'Placa de carga',
        'flex_carga' => 'Flex de carga', 'camera' => 'Câmera', 'flex_volume' => 'Flex de volume',
        'flex_power' => 'Flex power', 'outra' => 'Outra',
    ],
    'tipos_pagamento' => ['vista' => 'À vista', 'prazo' => 'A prazo', 'cartao' => 'Cartão', 'outro' => 'Outro'],
    'condicoes' => ['novo' => 'Novo', 'seminovo' => 'Seminovo', 'usado' => 'Usado', 'defeito' => 'Com defeito'],
    'perfis' => ['admin' => 'Administrador', 'tecnico' => 'Técnico', 'balcao' => 'Balcão'],
    'motivos_movimentacao' => [
        'garantia'  => ['Reposição em garantia', 'entrada'],
        'retorno'   => ['Retorno ao estoque', 'entrada'],
        'devolucao' => ['Devolvido ao fornecedor', 'saida'],
        'defeito'   => ['Baixa por defeito', 'saida'],
        'perda'     => ['Perda', 'saida'],
        'brinde'    => ['Brinde / cortesia', 'saida'],
        'ajuste'    => ['Ajuste de estoque', 'entrada'],
    ],
    // As listas de opcoes (opcoes_lista.lista): o nome que a tela mostra.
    'listas' => [
        'marcas' => 'Marcas', 'armazenamentos' => 'Armazenamento', 'cores' => 'Cores',
        'categorias_produto' => 'Categorias de produto', 'categorias_lancamento' => 'Categorias do financeiro',
    ],
    'escopos_chave' => ['geral' => 'Geral (todas as empresas)', 'empresa' => 'Só desta empresa'],

    // v7: fiscal e pedido de entrada
    'regimes' => [
        'mei' => 'MEI', 'simples' => 'Simples Nacional', 'simples_excesso' => 'Simples Nacional (excesso de sublimite)',
        'presumido' => 'Lucro Presumido', 'real' => 'Lucro Real',
    ],
    'ambientes' => ['homologacao' => 'Homologação (testes)', 'producao' => 'Produção'],
    'ufs' => [
        'AC' => 'Acre', 'AL' => 'Alagoas', 'AP' => 'Amapá', 'AM' => 'Amazonas', 'BA' => 'Bahia', 'CE' => 'Ceará',
        'DF' => 'Distrito Federal', 'ES' => 'Espírito Santo', 'GO' => 'Goiás', 'MA' => 'Maranhão', 'MT' => 'Mato Grosso',
        'MS' => 'Mato Grosso do Sul', 'MG' => 'Minas Gerais', 'PA' => 'Pará', 'PB' => 'Paraíba', 'PR' => 'Paraná',
        'PE' => 'Pernambuco', 'PI' => 'Piauí', 'RJ' => 'Rio de Janeiro', 'RN' => 'Rio Grande do Norte',
        'RS' => 'Rio Grande do Sul', 'RO' => 'Rondônia', 'RR' => 'Roraima', 'SC' => 'Santa Catarina', 'SP' => 'São Paulo',
        'SE' => 'Sergipe', 'TO' => 'Tocantins',
    ],
    'efeitos_estoque' => ['entra' => 'Entra no estoque', 'sai' => 'Sai do estoque', 'nao' => 'Não mexe no estoque'],
    'efeitos_financeiro' => ['pagar' => 'Gera conta a pagar', 'receber' => 'Gera conta a receber', 'nao' => 'Não gera conta'],
    'sentidos' => ['entrada' => 'Entrada', 'saida' => 'Saída'],
    'finalidades' => ['normal' => 'Normal', 'devolucao' => 'Devolução', 'ajuste' => 'Ajuste', 'complementar' => 'Complementar'],
    'status_pedido' => ['rascunho' => 'Rascunho', 'confirmado' => 'Confirmado', 'cancelado' => 'Cancelado'],
    // Origem da mercadoria (campo orig da NF-e), com o texto encurtado.
    'origens_mercadoria' => [
        '0' => '0 - Nacional',
        '1' => '1 - Estrangeira, importação direta',
        '2' => '2 - Estrangeira, comprada no mercado interno',
        '3' => '3 - Nacional, conteúdo de importação acima de 40% e até 70%',
        '4' => '4 - Nacional, produzida conforme processo produtivo básico (PPB)',
        '5' => '5 - Nacional, conteúdo de importação até 40%',
        '6' => '6 - Estrangeira, importação direta, sem similar nacional (lista CAMEX)',
        '7' => '7 - Estrangeira, mercado interno, sem similar nacional (lista CAMEX)',
        '8' => '8 - Nacional, conteúdo de importação acima de 70%',
    ],

    // v8: loja online. A ordem e a da entrega (STATUS_ENCOMENDA_TRILHA).
    'status_encomenda' => [
        'aguardando_pagamento' => 'Aguardando pagamento', 'pago' => 'Pagamento confirmado',
        'separacao' => 'Em separação', 'enviado' => 'Enviado', 'em_transito' => 'Em trânsito',
        'saiu_entrega' => 'Saiu para entrega', 'entregue' => 'Entregue', 'cancelada' => 'Cancelada',
    ],
];

/*
 * Loja online (v8): a encomenda anda UM passo por vez, nesta ordem, e o
 * rastreio que o cliente ve e esta linha. Cancelar e o unico desvio, e
 * so ate antes de entregue. A venda (estoque + financeiro) nasce no
 * "pago" - antes disso a encomenda so RESERVA o item.
 */
const STATUS_ENCOMENDA_TRILHA = ['aguardando_pagamento', 'pago', 'separacao', 'enviado', 'em_transito', 'saiu_entrega', 'entregue'];
const LOJA_FOTOS_MAX        = 4;            // fotos por anuncio
const LOJA_FOTO_BYTES_MAX   = 1048576;      // 1 MB por foto (a tela reduz antes de mandar)
const LOJA_ITENS_MAX        = 20;           // linhas por encomenda
const LOJA_QUANTIDADE_MAX   = 10;           // unidades de um anuncio numa encomenda

/*
 * "OS em andamento": o aparelho ainda esta na loja e o servico ainda nao
 * foi cobrado. 'pronta' entra - o conserto acabou, mas o cliente nao
 * buscou nem pagou. E a UNICA definicao: /resumo, /financeiro e o
 * relatorio contam com ela, e a tela so le os numeros prontos.
 */
const STATUS_OS_EM_ANDAMENTO   = ['aberta', 'orcamento', 'aprovada', 'em_reparo', 'pronta'];
/* Com a OS pronta ou entregue, pecas e servicos nao mudam mais. */
const STATUS_OS_ITENS_TRAVADOS = ['pronta', 'entregue'];
/* OS cancelada ou recusada nao consome estoque (vw_saidas_estoque ignora). */
const STATUS_OS_SEM_BAIXA      = ['cancelada', 'recusada'];
/* Ao entrar nestes status, a senha de desbloqueio do aparelho e apagada
   (o aparelho ja voltou para o cliente; r4: recusada tambem). */
const STATUS_OS_APAGA_SENHA    = ['entregue', 'cancelada', 'recusada'];

/*
 * "Parado no estoque" (o que ainda pode ser vendido): so celular tem
 * "vendido"; peca e produto vale o saldo. Colunas da vw_entradas - quem
 * usa le DESSA view (painel e /entradas?disponivel=1). Regra unica.
 */
const SQL_ESTOQUE_PARADO = "saldo > 0 AND (tipo <> 'celular' OR situacao <> 'vendido')";

/* Areas que so o admin enxerga. */
const ROTAS_SO_ADMIN = ['financeiro', 'relatorios', 'lancamentos', 'usuarios', 'chaves', 'empresa', 'fiscal',
                        'anuncios', 'fotos-anuncio', 'encomendas', 'loja-ajustes'];

/* Nome de cada campo do jeito que aparece na tela, para a mensagem de erro. */
const ROTULOS = [
    'nome' => 'Nome', 'usuario' => 'Login', 'descricao' => 'Descrição', 'modelo' => 'Modelo',
    'telefone' => 'Telefone', 'senha' => 'Senha',
];

/** Os valores validos de um dominio. */
function valoresDe(string $dominio): array
{
    // Sempre texto: as chaves "0".."8" (origem da mercadoria) o PHP guarda como inteiro.
    return array_map('strval', array_keys(DOMINIOS[$dominio]));
}

/** O rotulo de um valor (motivo devolve so o texto, sem o lado). */
function rotuloDe(string $dominio, ?string $valor): string
{
    $r = DOMINIOS[$dominio][$valor] ?? $valor;
    return is_array($r) ? $r[0] : (string) $r;
}

/** Erro previsto da API: vira uma resposta JSON com o codigo HTTP certo. */
class ErroApi extends RuntimeException
{
    public function __construct(public int $codigo, string $mensagem, public array $extra = [])
    {
        parent::__construct($mensagem);
    }
}

// ------------------------------------------------------------------
// Nomes: comparacao sem acento e sem caixa
// ------------------------------------------------------------------
/*
 * "Cartão de Crédito", "CARTAO DE CREDITO" e "cartao de credito" sao o
 * mesmo nome. Tira o acento por tabela (nao depende de extensao intl),
 * passa para minusculas e junta os espacos. E a funcao SQL minusculas().
 */
function normalizarNome(?string $texto): ?string
{
    if ($texto === null) {
        return null;
    }
    static $semAcento = [
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e',
        'ë' => 'e', 'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'ó' => 'o', 'ò' => 'o', 'ô' => 'o',
        'õ' => 'o', 'ö' => 'o', 'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ç' => 'c', 'ñ' => 'n',
    ];
    $minuscula = mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', $texto)));
    return strtr($minuscula, $semAcento);
}

// ------------------------------------------------------------------
// Banco
// ------------------------------------------------------------------
/*
 * Pasta das copias de seguranca do banco: dados\backups\ (ou
 * INDEX_CELULARES_BACKUPS). Fica junto do banco, dentro de dados\, para
 * o projeto ser uma pasta so: tudo que tem dado de cliente esta em dados\,
 * que nunca vai para o controle de versao nem para a copia do codigo.
 */
function pastaDeBackups(): string
{
    $outra = getenv('INDEX_CELULARES_BACKUPS');
    $pasta = $outra !== false && $outra !== '' ? $outra : dirname(__DIR__) . DIRECTORY_SEPARATOR . 'dados' . DIRECTORY_SEPARATOR . 'backups';
    if (!is_dir($pasta) && !@mkdir($pasta, 0777, true)) {
        throw new RuntimeException("não consegui criar a pasta de cópias de segurança {$pasta}");
    }
    return $pasta;
}

/** dados/index.sqlite, ou o arquivo apontado por INDEX_CELULARES_DB (testes). */
function caminhoBanco(): string
{
    $outro = getenv('INDEX_CELULARES_DB');
    return $outro !== false && $outro !== '' ? $outro : __DIR__ . '/../dados/index.sqlite';
}

/** Abre um arquivo SQLite do jeito que o sistema usa (API e instalador). */
function abrirSqlite(string $caminho): PDO
{
    $pdo = new PDO('sqlite:' . $caminho);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA busy_timeout = 5000');
    // LOWER() do SQLite so conhece A-Z; esta usa a mesma regra do PHP.
    $pdo->sqliteCreateFunction('minusculas', 'normalizarNome', 1, PDO::SQLITE_DETERMINISTIC);
    return $pdo;
}

function banco(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
            throw new ErroApi(500,
                'O PHP desta máquina está sem a extensão pdo_sqlite. Abra o php.ini e tire o ponto e '
                . 'vírgula das linhas extension=pdo_sqlite e extension=sqlite3.');
        }
        // Sem esta conferencia o SQLite cria um arquivo vazio no lugar.
        $caminho = caminhoBanco();
        if (!is_file($caminho)) {
            throw new ErroApi(503,
                'O banco de dados não foi encontrado. Peça ao responsável para rodar: php dados\\aplicar-estrutura.php');
        }
        $novo = abrirSqlite($caminho);
        $novo->exec('PRAGMA foreign_keys = ON');

        // Banco antigo (backup restaurado, maquina nova): aviso que diz o que fazer.
        $versao = (int) $novo->query('PRAGMA user_version')->fetchColumn();
        if ($versao !== VERSAO_BANCO) {
            throw new ErroApi(503, $versao < VERSAO_BANCO
                ? "O banco de dados está numa versão antiga ({$versao}; o sistema precisa da " . VERSAO_BANCO
                  . '). Peça ao responsável para rodar: php dados\\aplicar-estrutura.php'
                : "O banco de dados é de uma versão mais nova do sistema ({$versao}). Atualize os arquivos do sistema.");
        }
        $pdo = $novo;
    }
    return $pdo;
}

function consultar(string $sql, array $parametros = []): array
{
    $st = banco()->prepare($sql);
    $st->execute($parametros);
    return $st->fetchAll();
}

function consultarUm(string $sql, array $parametros = []): ?array
{
    $linhas = consultar($sql, $parametros);
    return $linhas[0] ?? null;
}

function executarSql(string $sql, array $parametros = []): int
{
    $st = banco()->prepare($sql);
    $st->execute($parametros);
    return $st->rowCount();
}

/** "?, ?, ?" para um IN com a lista dada. */
function vagas(array $valores): string
{
    return implode(', ', array_fill(0, max(1, count($valores)), '?'));
}

/*
 * Roda o trabalho inteiro dentro de UMA transacao: ou grava tudo, ou nada.
 * Se ja houver uma aberta, so faz parte dela - quem abriu e quem fecha.
 */
function emTransacao(callable $trabalho)
{
    $pdo = banco();
    if ($pdo->inTransaction()) {
        return $trabalho();
    }
    $pdo->beginTransaction();
    try {
        $resultado = $trabalho();
        $pdo->commit();
        return $resultado;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

// ------------------------------------------------------------------
// Senhas
// ------------------------------------------------------------------
// Formato guardado no banco:  pbkdf2$sha256$<iteracoes>$<salt hex>$<hash hex>
function gerarHash(string $senha): string
{
    $salt = random_bytes(16);
    $hash = hash_pbkdf2('sha256', $senha, $salt, ITERACOES, 32, true);
    return 'pbkdf2$sha256$' . ITERACOES . '$' . bin2hex($salt) . '$' . bin2hex($hash);
}

/*
 * Hash de mentira, no formato certo, para conferir a senha de um login
 * que nao existe: a resposta demora o mesmo que a de um login real, e o
 * tempo nao diz quais logins existem.
 */
const HASH_FALSO = 'pbkdf2$sha256$120000$00000000000000000000000000000000$'
                 . '0000000000000000000000000000000000000000000000000000000000000000';

function conferirSenha(string $senha, ?string $guardado): bool
{
    $partes = explode('$', (string) $guardado);
    if (count($partes) !== 5 || $partes[0] !== 'pbkdf2') {
        return false;
    }
    [, $algoritmo, $iteracoes, $saltHex, $hashHex] = $partes;
    $tamanho = strlen($hashHex) / 2;
    if ($tamanho < 1) {
        return false;
    }
    $calculado = hash_pbkdf2($algoritmo, $senha, hex2bin($saltHex), (int) $iteracoes, (int) $tamanho, true);
    return hash_equals(hex2bin($hashHex), $calculado);
}

/*
 * A regra da senha (REGRA_SENHA), uma so: troca obrigatoria, Configuracoes
 * e cadastro de usuario. Devolve o motivo de recusar, ou null.
 */
function senhaFraca(string $senha, string $login): ?string
{
    if (mb_strlen($senha) < SENHA_MIN) {
        return 'A senha precisa ter pelo menos ' . SENHA_MIN . ' caracteres.';
    }
    if (!preg_match('/\p{L}/u', $senha) || !preg_match('/\d/', $senha)) {
        return 'A senha precisa ter letras e números.';
    }
    $simples = normalizarNome($senha);
    $usuario = normalizarNome($login);
    if (mb_strlen($usuario) >= 3 && str_contains($simples, $usuario)) {
        return 'A senha não pode conter o login.';
    }
    if (in_array($simples, SENHAS_COMUNS, true)) {
        return 'Essa senha é muito comum e fácil de adivinhar. Escolha outra.';
    }
    // "aaaaaaaa", "senhasenha", "12121212": um pedaco repetido.
    if (preg_match('/^(.+?)\1+$/u', $simples)) {
        return 'A senha não pode ser uma repetição (como "senhasenha" ou "12121212").';
    }
    return null;
}

// ------------------------------------------------------------------
// Resposta, corpo e validacao
// ------------------------------------------------------------------
function responder(int $codigo, array $corpo): void
{
    http_response_code($codigo);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($corpo, JSON_UNESCAPED_UNICODE);
}

function corpoJson(): array
{
    $bruto = file_get_contents('php://input');
    if (trim((string) $bruto) === '') {
        return [];
    }
    $dados = json_decode($bruto, true);
    if (!is_array($dados)) {
        throw new ErroApi(400, 'O corpo da requisição não é um JSON válido.');
    }
    return $dados;
}

function rotulo(string $campo, ?string $rotulo = null): string
{
    return $rotulo ?? ROTULOS[$campo] ?? $campo;
}

/** Texto do corpo, sem espacos nas pontas; vazio vira null. */
function txt(array $corpo, string $campo, ?string $rotulo = null): ?string
{
    $valor = $corpo[$campo] ?? null;
    if ($valor === null) {
        return null;
    }
    if (!is_scalar($valor)) {
        throw new ErroApi(400, 'O campo "' . rotulo($campo, $rotulo) . '" precisa ser um texto.');
    }
    $valor = trim((string) $valor);
    return $valor === '' ? null : $valor;
}

/** PUT parcial: campo que nao veio no corpo continua com o valor gravado. */
function txtOu(array $corpo, string $campo, ?array $atual): ?string
{
    if (!array_key_exists($campo, $corpo) && $atual !== null) {
        return $atual[$campo] ?? null;
    }
    return txt($corpo, $campo);
}

function obrigatorio(array $corpo, string $campo, ?string $rotulo = null): string
{
    $valor = txt($corpo, $campo, $rotulo);
    if ($valor === null) {
        throw new ErroApi(400, 'O campo "' . rotulo($campo, $rotulo) . '" é obrigatório.');
    }
    return $valor;
}

/** O campo veio no corpo com um valor (nem ausente, nem null, nem "")? */
function veio(array $corpo, string $campo): bool
{
    return array_key_exists($campo, $corpo) && $corpo[$campo] !== null && $corpo[$campo] !== '';
}

function moedaBr(float $valor): string
{
    return 'R$ ' . number_format($valor, 2, ',', '.');
}

/*
 * Dinheiro em CENTAVOS INTEIROS. O nome diz a unidade: no JS da tela a
 * funcao parecida devolve reais arredondados, e a confusao seria de 100x.
 */
function emCentavos($valor): int
{
    return (int) round(((float) $valor) * 100);
}

/*
 * O parser de dinheiro, um so: aceita 12.5, "12,50" e "12.50"; devolve
 * null se nao for numero. Quem valida faixa e dinheiro().
 */
function lerDinheiro($valor): ?float
{
    if (is_string($valor)) {
        $valor = str_replace(',', '.', trim($valor));
    }
    if (is_int($valor) || is_float($valor) || (is_string($valor) && is_numeric($valor))) {
        return round((float) $valor, 2);
    }
    return null;
}

/*
 * Le um valor em dinheiro e confere a faixa: nem negativo, nem maior que
 * VALOR_MAXIMO, nem texto. Ausente ou vazio vale $padrao.
 */
function dinheiro(array $corpo, string $campo, string $rotulo, float $padrao = 0.0): float
{
    if (!veio($corpo, $campo)) {
        return $padrao;
    }
    $valor = lerDinheiro($corpo[$campo]);
    if ($valor === null) {
        throw new ErroApi(400, "O campo \"{$rotulo}\" precisa ser um valor em reais.");
    }
    if ($valor < 0) {
        throw new ErroApi(400, "O campo \"{$rotulo}\" não pode ser negativo.");
    }
    conferirTeto($valor, "O campo \"{$rotulo}\"");
    return $valor;
}

/* Teto de valor com o nome do que se esta gravando ("O total da venda"...). */
function conferirTeto(float $valor, string $oQue): void
{
    if ($valor > VALOR_MAXIMO) {
        throw new ErroApi(400, "{$oQue} passou do limite de " . moedaBr(VALOR_MAXIMO) . '. Confira se não sobrou um dígito.');
    }
}

/*
 * Le um inteiro e confere a faixa. Quantidade 0, -3 ou 1,5 e recusada com
 * 400 - nunca vira 1 em silencio.
 */
function inteiro(array $corpo, string $campo, string $rotulo, int $minimo, int $maximo, ?int $padrao): ?int
{
    if (!veio($corpo, $campo)) {
        return $padrao;
    }
    $valor = $corpo[$campo];
    if (is_float($valor) && floor($valor) === $valor) {
        $valor = (int) $valor;
    } elseif (is_string($valor) && preg_match('/^\s*-?\d+\s*$/', $valor)) {
        $valor = (int) trim($valor);
    }
    if (!is_int($valor)) {
        throw new ErroApi(400, "O campo \"{$rotulo}\" precisa ser um número inteiro.");
    }
    if ($valor < $minimo || $valor > $maximo) {
        throw new ErroApi(400, "O campo \"{$rotulo}\" precisa ficar entre {$minimo} e {$maximo}.");
    }
    return $valor;
}

/** Data AAAA-MM-DD (ou AAAA-MM-DD HH:MM:SS com $comHora) do corpo, conferida. */
function dataDoCorpo(array $corpo, string $campo, string $rotulo, bool $comHora = false): ?string
{
    $valor = txt($corpo, $campo, $rotulo);
    if ($valor === null) {
        return null;
    }
    $padrao = $comHora ? '/^(\d{4})-(\d{2})-(\d{2})( \d{2}:\d{2}(:\d{2})?)?$/' : '/^(\d{4})-(\d{2})-(\d{2})$/';
    if (!preg_match($padrao, $valor, $p) || !checkdate((int) $p[2], (int) $p[3], (int) $p[1])) {
        throw new ErroApi(400, "O campo \"{$rotulo}\" precisa ser uma data válida (AAAA-MM-DD).");
    }
    return $valor;
}

/** Soma meses sem pular mes: 31/01 + 1 = 28/02 (ou 29), + 2 = 31/03. */
function somarMeses(string $data, int $meses): string
{
    [$ano, $mes, $dia] = array_map('intval', explode('-', substr($data, 0, 10)));
    $total  = $ano * 12 + ($mes - 1) + $meses;
    $ano    = intdiv($total, 12);
    $mes    = $total % 12 + 1;
    $ultimo = (int) date('t', mktime(0, 0, 0, $mes, 1, $ano));
    return sprintf('%04d-%02d-%02d', $ano, $mes, min($dia, $ultimo));
}

function dataBr(?string $data): string
{
    return $data ? date('d/m/Y', strtotime(substr($data, 0, 10))) : '';
}

function exigir(bool $condicao): void
{
    if (!$condicao) {
        throw new ErroApi(405, 'Método não permitido para esta rota.');
    }
}

function exigirId(?int $id): int
{
    if (!$id) {
        throw new ErroApi(400, 'Informe o id do registro na URL.');
    }
    return $id;
}

function agora(): string
{
    return date('Y-m-d H:i:s');
}

/* Carimbo com milissegundos para a versao da OS. */
function carimbo(): string
{
    $t = microtime(true);
    return date('Y-m-d H:i:s', (int) $t) . sprintf('.%03d', (int) (($t - floor($t)) * 1000));
}

/*
 * Erro nao previsto: o detalhe vai para dados/erros.log e o navegador
 * recebe uma frase generica. O corpo da requisicao NUNCA e gravado, e os
 * argumentos das funcoes ficam fora da pilha (zend.exception_ignore_args,
 * ligado pelo roteador) - senao uma senha recebida pelo login iria parar
 * no log em texto puro.
 */
function registrarErro(Throwable $erro, string $metodo, string $caminho): void
{
    $linha = sprintf("[%s] %s %s\n%s: %s\nem %s:%d\n%s\n\n",
        date('Y-m-d H:i:s'), $metodo, $caminho, get_class($erro), $erro->getMessage(),
        $erro->getFile(), $erro->getLine(), $erro->getTraceAsString());
    $outro = getenv('INDEX_CELULARES_LOG');   // os testes mandam para a pasta temporaria
    @file_put_contents($outro !== false && $outro !== '' ? $outro : __DIR__ . '/../dados/erros.log', $linha, FILE_APPEND | LOCK_EX);
}

// ------------------------------------------------------------------
// Sessao e origem
// ------------------------------------------------------------------
function requisicaoHttps(): bool
{
    return (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443'
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

function iniciarSessao(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    // Coleta de lixo e cookie seguem a MESMA duracao; o limite de verdade
    // e a hora do login, conferida em usuarioDaSessao().
    ini_set('session.gc_maxlifetime', (string) SESSAO_SEGUNDOS);
    ini_set('session.use_strict_mode', '1');
    session_set_cookie_params([
        'lifetime' => SESSAO_SEGUNDOS,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Strict',
        'secure'   => requisicaoHttps(),
    ]);
    session_start();
}

function encerrarSessao(): void
{
    iniciarSessao();
    $_SESSION = [];
    $p = session_get_cookie_params();
    setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'],
        'secure' => $p['secure'], 'httponly' => $p['httponly'], 'samesite' => $p['samesite']]);
    session_destroy();
}

/** Usuario logado, ou null ($expirou diz se passou das 8 horas). */
function usuarioDaSessao(?bool &$expirou = null): ?array
{
    $expirou = false;
    iniciarSessao();
    $id = $_SESSION['usuario_id'] ?? null;
    if (!$id) {
        return null;
    }
    if (time() - (int) ($_SESSION['login_em'] ?? 0) > SESSAO_SEGUNDOS) {
        encerrarSessao();
        $expirou = true;
        return null;
    }
    return consultarUm('SELECT id, usuario, nome, perfil FROM usuarios WHERE id = ? AND ativo = 1', [$id]);
}

/** host[:porta] de uma URL, em minusculas, ou '' se nao der para ler. */
function hostDe(string $url): string
{
    $host = (string) parse_url($url, PHP_URL_HOST);
    $porta = parse_url($url, PHP_URL_PORT);
    return $host === '' ? '' : strtolower($host . ($porta ? ':' . $porta : ''));
}

/*
 * Toda requisicao que muda dado precisa:
 *   - de Content-Type application/json quando manda corpo (POST, PUT,
 *     PATCH) - um formulario de outro site nao consegue mandar isso;
 *   - de Origin do proprio host, ou, sem Origin, de Referer do proprio
 *     host. Sem nenhum dos dois, 403.
 * O fetch do navegador manda os dois sozinho; o SameSite=Strict do cookie
 * e a terceira tranca.
 */
function conferirOrigem(string $metodo): void
{
    if (in_array($metodo, ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }
    if (in_array($metodo, ['POST', 'PUT', 'PATCH'], true)) {
        $tipo = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''));
        if (!str_starts_with(trim($tipo), 'application/json')) {
            throw new ErroApi(403, 'Pedido recusado: envie os dados como JSON (Content-Type: application/json).');
        }
    }
    $daqui  = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $origem = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    $veioDe = $origem !== '' ? hostDe($origem) : hostDe((string) ($_SERVER['HTTP_REFERER'] ?? ''));
    if ($daqui === '' || $veioDe !== $daqui) {
        throw new ErroApi(403, 'Pedido recusado: ele não veio de uma página do sistema.');
    }
}

/** IP do outro lado; local = a propria maquina. */
function ipDoCliente(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

function ipLocal(string $ip): bool
{
    return in_array($ip, ['127.0.0.1', '::1', '::ffff:127.0.0.1', ''], true);
}
