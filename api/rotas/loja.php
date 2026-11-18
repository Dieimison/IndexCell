<?php
/**
 * api/rotas/loja.php - loja online (v8): a vitrine do cliente e o lado do
 * administrador.
 *
 * CLIENTE (telas em Loja\; sessao PROPRIA, cookie INDEXLOJA so em /api/loja -
 * a conta do cliente nunca abre o painel, e o login do painel nunca vale aqui):
 *   GET  /api/loja/vitrine                  nome da loja, frete, prazos e os anuncios publicados
 *   GET  /api/loja/anuncios/{id}            um anuncio publicado
 *   GET  /api/loja/fotos/{id}               a foto (so de anuncio publicado)
 *   POST /api/loja/conta                    criar conta {nome, email, telefone, cpf?, senha} (ja entra)
 *   POST /api/loja/entrar {email, senha}    POST /api/loja/sair    GET /api/loja/sessao
 *   GET|POST /api/loja/enderecos            DELETE /api/loja/enderecos/{id}
 *   GET|POST /api/loja/encomendas           GET /api/loja/encomendas/{id} (a encomenda e o rastreio)
 *   POST /api/loja/encomendas/{id}/cancelar (so enquanto aguarda o pagamento)
 *
 * ADMINISTRADOR (sessao do painel; ROTAS_SO_ADMIN):
 *   /api/anuncios  GET, POST, PUT /{id}, DELETE /{id}     GET /api/fotos-anuncio/{id}
 *   GET /api/encomendas[?status=]   GET /api/encomendas/{id}
 *   POST /api/encomendas/{id}/pagamento   confirma o pagamento: nasce a venda
 *   POST /api/encomendas/{id}/avancar     o proximo passo da entrega {para, local, observacao, transportadora, codigo_rastreio}
 *   POST /api/encomendas/{id}/cancelar    {motivo}; ja paga, a venda e cancelada junto (estorno)
 *   GET|PUT /api/loja-ajustes             aberta, frete, prazos, chave PIX, cidade de origem
 *
 * A encomenda so RESERVA o item ate o pagamento (reservadoNaLoja). O PDV e a
 * OS tambem respeitam a reserva (prepararItensDeSaida). No pagamento, a venda
 * e gravada pela MESMA gravarVenda do PDV: o estoque baixa, o celular sai da
 * prateleira e nasce a conta a receber ja paga, no Pix.
 */

declare(strict_types=1);

const SESSAO_LOJA_NOME = 'INDEXLOJA';
const MOTIVO_PRAZO_VENCIDO = 'O prazo de pagamento passou e a reserva foi desfeita.';

// ------------------------------------------------------------------
// Sessao do cliente
// ------------------------------------------------------------------
function iniciarSessaoLoja(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    ini_set('session.gc_maxlifetime', (string) SESSAO_SEGUNDOS);
    ini_set('session.use_strict_mode', '1');
    session_name(SESSAO_LOJA_NOME);
    session_set_cookie_params([
        'lifetime' => SESSAO_SEGUNDOS,
        'path'     => '/api/loja',
        'httponly' => true,
        'samesite' => 'Strict',
        'secure'   => requisicaoHttps(),
    ]);
    session_start();
}

function encerrarSessaoLoja(): void
{
    iniciarSessaoLoja();
    $_SESSION = [];
    $p = session_get_cookie_params();
    setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'],
        'secure' => $p['secure'], 'httponly' => $p['httponly'], 'samesite' => $p['samesite']]);
    session_destroy();
}

/** A conta logada na vitrine, ou null. */
function contaDaSessao(?bool &$expirou = null): ?array
{
    $expirou = false;
    iniciarSessaoLoja();
    $id = $_SESSION['loja_conta_id'] ?? null;
    if (!$id) {
        return null;
    }
    if (time() - (int) ($_SESSION['loja_login_em'] ?? 0) > SESSAO_SEGUNDOS) {
        encerrarSessaoLoja();
        $expirou = true;
        return null;
    }
    return consultarUm('SELECT id, email, nome, telefone, cpf, cliente_id FROM loja_contas WHERE id = ? AND ativo = 1', [$id]);
}

function abrirSessaoLoja(int $contaId): void
{
    iniciarSessaoLoja();
    session_regenerate_id(true);
    $_SESSION['loja_conta_id'] = $contaId;
    $_SESSION['loja_login_em'] = time();
}

/** O que a tela da loja pode saber da conta (nada de hash, nada de cliente_id). */
function contaParaTela(array $c): array
{
    return ['id' => (int) $c['id'], 'nome' => $c['nome'], 'email' => $c['email'], 'telefone' => $c['telefone'],
            'cpf' => $c['cpf']];
}

// ------------------------------------------------------------------
// Conferencia dos campos do cliente
// ------------------------------------------------------------------
function emailDoCorpo(array $corpo): string
{
    $email = mb_strtolower((string) obrigatorio($corpo, 'email', 'E-mail'));
    if (mb_strlen($email) > 120 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        throw new ErroApi(400, 'Confira o e-mail: ele precisa ser do jeito nome@provedor.com.');
    }
    return $email;
}

/** Telefone com DDD: 10 ou 11 numeros (o resto e tirado). */
function telefoneDoCorpo(array $corpo, string $campo, bool $exigido): ?string
{
    $bruto = txt($corpo, $campo, 'Telefone');
    if ($bruto === null) {
        if ($exigido) {
            throw new ErroApi(400, 'Informe um telefone com DDD: é por ele que a loja fala com você sobre a entrega.');
        }
        return null;
    }
    $numeros = (string) preg_replace('/\D/', '', $bruto);
    if (strlen($numeros) < 10 || strlen($numeros) > 11) {
        throw new ErroApi(400, 'O telefone precisa ter o DDD e o número (10 ou 11 dígitos), como (11) 98765-4321.');
    }
    return $numeros;
}

/** CPF e opcional; se vier, tem de conferir pelos digitos verificadores. */
function cpfDoCorpo(array $corpo): ?string
{
    $bruto = txt($corpo, 'cpf', 'CPF');
    if ($bruto === null) {
        return null;
    }
    $cpf = (string) preg_replace('/\D/', '', $bruto);
    if (!cpfValido($cpf)) {
        throw new ErroApi(400, 'Este CPF não confere. Confira os números (ou deixe o campo vazio).');
    }
    return $cpf;
}

function cpfValido(string $cpf): bool
{
    if (!preg_match('/^\d{11}$/', $cpf) || preg_match('/^(\d)\1{10}$/', $cpf)) {
        return false;
    }
    for ($t = 9; $t < 11; $t++) {
        $soma = 0;
        for ($i = 0; $i < $t; $i++) {
            $soma += (int) $cpf[$i] * ($t + 1 - $i);
        }
        $dv = ((10 * $soma) % 11) % 10;
        if ((int) $cpf[$t] !== $dv) {
            return false;
        }
    }
    return true;
}

/** Texto com teto de tamanho (o que passa e recusado, nunca cortado em silencio). */
function textoCurto(array $corpo, string $campo, string $rotulo, int $maximo, bool $exigido = false): ?string
{
    $valor = $exigido ? obrigatorio($corpo, $campo, $rotulo) : txt($corpo, $campo, $rotulo);
    if ($valor !== null && mb_strlen($valor) > $maximo) {
        throw new ErroApi(400, "O campo \"{$rotulo}\" passou de {$maximo} caracteres.");
    }
    return $valor;
}

/** Endereco de entrega conferido (o que vai para loja_enderecos e para a encomenda). */
function enderecoDoCorpo(array $e): array
{
    $cep = (string) preg_replace('/\D/', '', (string) (txt($e, 'cep', 'CEP') ?? ''));
    if (strlen($cep) !== 8) {
        throw new ErroApi(400, 'O CEP precisa ter 8 números.');
    }
    $uf = strtoupper((string) (txt($e, 'uf', 'UF') ?? ''));
    if (!in_array($uf, valoresDe('ufs'), true)) {
        throw new ErroApi(400, 'Escolha o estado (UF) do endereço.');
    }
    return [
        'destinatario' => textoCurto($e, 'destinatario', 'Quem recebe', 100, true),
        'cep'          => $cep,
        'logradouro'   => textoCurto($e, 'logradouro', 'Rua', 120, true),
        'numero'       => textoCurto($e, 'numero', 'Número', 10, true),
        'complemento'  => textoCurto($e, 'complemento', 'Complemento', 60),
        'bairro'       => textoCurto($e, 'bairro', 'Bairro', 60, true),
        'cidade'       => textoCurto($e, 'cidade', 'Cidade', 60, true),
        'uf'           => $uf,
    ];
}

function cepFormatado(string $cep): string
{
    return strlen($cep) === 8 ? substr($cep, 0, 5) . '-' . substr($cep, 5) : $cep;
}

// ------------------------------------------------------------------
// Ajustes, reserva e frete
// ------------------------------------------------------------------
function ajustesLoja(): array
{
    $a = consultarUm('SELECT * FROM loja_ajustes WHERE id = 1');
    if (!$a) {
        executarSql('INSERT OR IGNORE INTO loja_ajustes (id) VALUES (1)');
        $a = consultarUm('SELECT * FROM loja_ajustes WHERE id = 1');
    }
    return $a;
}

function nomeDaVitrine(array $a): string
{
    return $a['nome_vitrine'] ?: (empresaAtual()['nome'] ?? null) ?: 'Index Celulares';
}

/** Frete da encomenda: fixo, ou zero a partir do valor do "gratis acima de". */
function freteDe(float $produtos, array $a): float
{
    $gratis = (float) $a['frete_gratis_acima'];
    return $gratis > 0 && emCentavos($produtos) >= emCentavos($gratis) ? 0.0 : round((float) $a['frete_fixo'], 2);
}

/** Unidades de uma entrada seguradas por encomendas que aguardam pagamento. */
function reservadoNaLoja(int $entradaId): int
{
    return (int) consultarUm(
        "SELECT COALESCE(SUM(ei.quantidade), 0) AS q
           FROM encomenda_itens ei JOIN encomendas en ON en.id = ei.encomenda_id
          WHERE ei.entrada_id = ? AND en.status = 'aguardando_pagamento'", [$entradaId])['q'];
}

/*
 * Encomenda que passou do prazo de pagamento e cancelada aqui, na hora em que
 * alguem olha (vitrine, lista, nova encomenda): a reserva cai sozinha, sem
 * tarefa agendada. O evento conta o porque ao cliente.
 */
function expirarEncomendas(): void
{
    $vencidas = consultar("SELECT id FROM encomendas WHERE status = 'aguardando_pagamento' AND pagar_ate < ?", [agora()]);
    foreach ($vencidas as $v) {
        emTransacao(function () use ($v) {
            $mudou = executarSql("UPDATE encomendas SET status = 'cancelada', motivo_cancelamento = ?, atualizado_em = ?
                                   WHERE id = ? AND status = 'aguardando_pagamento'", [MOTIVO_PRAZO_VENCIDO, agora(), $v['id']]);
            if ($mudou) {
                registrarEvento((int) $v['id'], 'cancelada', null, MOTIVO_PRAZO_VENCIDO, null);
            }
        });
    }
}

function registrarEvento(int $encomendaId, string $status, ?string $local, ?string $observacao, ?int $usuarioId): void
{
    executarSql('INSERT INTO encomenda_eventos (encomenda_id, status, momento, local, observacao, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
                [$encomendaId, $status, agora(), $local, $observacao, $usuarioId]);
}

/*
 * Os anuncios com o item do estoque, o saldo, o que esta reservado e o que
 * ainda da para vender. Celular vendido nao tem o que vender, mesmo com
 * saldo antigo (a mesma regra do "parado no estoque").
 */
const SQL_ANUNCIOS = "SELECT a.*, e.tipo, e.item, e.marca, e.categoria, e.cor, e.condicao, e.imei, e.situacao,
                             e.saldo, e.valor_venda AS preco_balcao, e.valor_investimento AS custo_unitario,
                             COALESCE((SELECT SUM(ei.quantidade) FROM encomenda_itens ei
                                         JOIN encomendas en ON en.id = ei.encomenda_id
                                        WHERE ei.entrada_id = a.entrada_id AND en.status = 'aguardando_pagamento'), 0) AS reservado,
                             (SELECT GROUP_CONCAT(f.id) FROM (SELECT id FROM anuncio_fotos
                                                              WHERE anuncio_id = a.id ORDER BY ordem, id) f) AS fotos_ids
                        FROM anuncios a
                        JOIN vw_entradas e ON e.id = a.entrada_id";

function prepararAnuncio(array $a): array
{
    $vendavel = (int) $a['saldo'] > 0 && !($a['tipo'] === 'celular' && $a['situacao'] === 'vendido');
    $a['disponivel'] = $vendavel ? max(0, (int) $a['saldo'] - (int) $a['reservado']) : 0;
    $a['fotos'] = $a['fotos_ids'] === null || $a['fotos_ids'] === '' ? [] : array_map('intval', explode(',', (string) $a['fotos_ids']));
    unset($a['fotos_ids']);
    foreach (['id', 'entrada_id', 'publicado', 'saldo', 'reservado'] as $c) {
        $a[$c] = (int) $a[$c];
    }
    $a['preco'] = (float) $a['preco'];
    return $a;
}

/** O que o cliente ve de um anuncio: sem custo, sem IMEI, sem id do estoque. */
function anuncioParaVitrine(array $a): array
{
    return ['id' => $a['id'], 'titulo' => $a['titulo'], 'descricao' => $a['descricao'], 'preco' => $a['preco'],
            'tipo' => $a['tipo'], 'tipo_rotulo' => rotuloDe('tipos_entrada', $a['tipo']),
            'marca' => $a['marca'], 'categoria' => $a['categoria'], 'cor' => $a['cor'],
            'condicao' => $a['condicao'] ? rotuloDe('condicoes', $a['condicao']) : null,
            'disponivel' => $a['disponivel'], 'unitario' => $a['tipo'] === 'celular',
            'fotos' => $a['fotos']];
}

// ------------------------------------------------------------------
// Roteador do cliente: /api/loja/...
// ------------------------------------------------------------------
function tratarLoja(array $partes, string $metodo, array $corpo): void
{
    $recurso = strtolower($partes[0] ?? '');
    $id = null;
    if (isset($partes[1])) {
        if (!ctype_digit($partes[1]) || (int) $partes[1] < 1) {
            throw new ErroApi(404, 'Registro não encontrado.');
        }
        $id = (int) $partes[1];
    }
    $acao = isset($partes[2]) ? strtolower($partes[2]) : null;
    if (count($partes) > 3 || ($acao !== null && !($recurso === 'encomendas' && $acao === 'cancelar'))) {
        throw new ErroApi(404, 'Rota não encontrada.');
    }

    // O que qualquer visitante ve: a vitrine, um anuncio, a foto.
    if ($recurso === 'vitrine' && $metodo === 'GET' && $id === null) {
        responder(200, ['ok' => true] + vitrine());
        return;
    }
    if ($recurso === 'anuncios' && $metodo === 'GET' && $id !== null) {
        $a = consultarUm(SQL_ANUNCIOS . ' WHERE a.id = ? AND a.publicado = 1', [$id]);
        if (!$a) {
            throw new ErroApi(404, 'Este produto não está mais na vitrine.');
        }
        responder(200, ['ok' => true, 'anuncio' => anuncioParaVitrine(prepararAnuncio($a))]);
        return;
    }
    if ($recurso === 'fotos' && $metodo === 'GET' && $id !== null) {
        enviarFoto(consultarUm('SELECT f.tipo, f.dados FROM anuncio_fotos f JOIN anuncios a ON a.id = f.anuncio_id
                                 WHERE f.id = ? AND a.publicado = 1', [$id]));
        return;
    }
    if ($recurso === 'conta' && $metodo === 'POST' && $id === null) {
        [$codigo, $resposta] = criarContaLoja($corpo);
        responder($codigo, $resposta);
        return;
    }
    if ($recurso === 'entrar' && $metodo === 'POST' && $id === null) {
        entrarNaLoja($corpo);
        return;
    }
    if ($recurso === 'sair' && $metodo === 'POST' && $id === null) {
        encerrarSessaoLoja();
        responder(200, ['ok' => true]);
        return;
    }

    $conta = contaDaSessao($expirou);
    if ($recurso === 'sessao' && $metodo === 'GET' && $id === null) {
        responder($conta ? 200 : 401, $conta ? ['ok' => true, 'conta' => contaParaTela($conta)]
                                             : ['ok' => false, 'erro' => 'Entre na sua conta.']);
        return;
    }
    if (!$conta) {
        responder(401, ['ok' => false, 'erro' => $expirou ? 'Sua sessão passou de 8 horas. Entre de novo.' : 'Entre na sua conta para continuar.']);
        return;
    }

    switch ($recurso) {
        case 'enderecos':
            [$codigo, $resposta] = enderecosDaConta($conta, $id, $metodo, $corpo);
            break;
        case 'encomendas':
            [$codigo, $resposta] = encomendasDoCliente($conta, $id, $acao, $metodo, $corpo);
            break;
        default:
            throw new ErroApi(404, 'Rota não encontrada: /api/loja/' . $recurso);
    }
    responder($codigo, $resposta);
}

function vitrine(): array
{
    expirarEncomendas();
    $a = ajustesLoja();
    // Celular vendido nao volta (aparelho unico): sai da vitrine sozinho. Produto esgotado
    // continua, no fim, ate o admin ligar o anuncio a entrada nova (reposicao).
    $anuncios = array_map(fn ($x) => anuncioParaVitrine(prepararAnuncio($x)),
        consultar(SQL_ANUNCIOS . " WHERE a.publicado = 1 AND NOT (e.tipo = 'celular' AND e.situacao = 'vendido')
                                   ORDER BY a.atualizado_em DESC, a.id DESC"));
    // O que tem para vender primeiro; esgotado vai para o fim (continua visivel).
    usort($anuncios, fn ($x, $y) => ($y['disponivel'] > 0) <=> ($x['disponivel'] > 0));
    return ['loja' => [
        'nome' => nomeDaVitrine($a), 'aberta' => (int) $a['aberta'] === 1,
        'frete_fixo' => (float) $a['frete_fixo'], 'frete_gratis_acima' => (float) $a['frete_gratis_acima'],
        'prazo_pagamento_horas' => (int) $a['prazo_pagamento_horas'], 'prazo_entrega_dias' => (int) $a['prazo_entrega_dias'],
        'cidade_origem' => $a['cidade_origem'],
    ], 'anuncios' => $anuncios, 'ufs' => dominioParaTela('ufs')];
}

function enviarFoto(?array $foto): void
{
    if (!$foto) {
        responder(404, ['ok' => false, 'erro' => 'Foto não encontrada.']);
        return;
    }
    http_response_code(200);
    header('Content-Type: ' . $foto['tipo']);
    header('Content-Length: ' . strlen((string) $foto['dados']));
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'");
    header('Cache-Control: private, max-age=86400');
    echo $foto['dados'];
}

// ------------------------------------------------------------------
// Conta: criar e entrar
// ------------------------------------------------------------------
function criarContaLoja(array $corpo): array
{
    $nome = textoCurto($corpo, 'nome', 'Nome', 100, true);
    $email = emailDoCorpo($corpo);
    $telefone = telefoneDoCorpo($corpo, 'telefone', true);
    $cpf = cpfDoCorpo($corpo);
    $senha = is_string($corpo['senha'] ?? null) ? $corpo['senha'] : '';
    $fraca = senhaFraca($senha, (string) strstr($email, '@', true));
    if ($fraca !== null) {
        throw new ErroApi(400, str_replace('o login', 'o seu e-mail', $fraca));
    }
    if (consultarUm('SELECT id FROM loja_contas WHERE email = ?', [$email])) {
        throw new ErroApi(400, 'Já existe uma conta com este e-mail. Use "Entrar" (ou outro e-mail).');
    }
    executarSql('INSERT INTO loja_contas (email, nome, telefone, cpf, senha_hash, ultimo_acesso) VALUES (?, ?, ?, ?, ?, ?)',
                [$email, $nome, $telefone, $cpf, gerarHash($senha), agora()]);
    $id = (int) banco()->lastInsertId();
    abrirSessaoLoja($id);
    return [201, ['ok' => true, 'mensagem' => 'Conta criada. Boas compras!',
                  'conta' => contaParaTela(consultarUm('SELECT * FROM loja_contas WHERE id = ?', [$id]))]];
}

/*
 * O mesmo limite do login do painel (5 erros em 15 minutos travam o e-mail;
 * por IP so fora da maquina), na mesma tabela, com o prefixo "loja:" - o
 * e-mail de um cliente nunca trava o login de um funcionario.
 */
function entrarNaLoja(array $corpo): void
{
    $email = mb_strtolower((string) (txt($corpo, 'email') ?? ''));
    $senha = is_string($corpo['senha'] ?? null) ? $corpo['senha'] : '';
    if ($email === '' || $senha === '') {
        responder(400, ['ok' => false, 'erro' => 'Informe e-mail e senha.']);
        return;
    }
    $chave = 'loja:' . $email;
    $ip = ipDoCliente();
    $espera = minutosDeBloqueio($chave, $ip);
    if ($espera > 0) {
        responder(429, ['ok' => false, 'erro' => "Muitas tentativas. Tente de novo em {$espera} minutos."]);
        return;
    }
    $linha = consultarUm('SELECT * FROM loja_contas WHERE email = ? AND ativo = 1', [$email]);
    $certa = conferirSenha($senha, $linha['senha_hash'] ?? HASH_FALSO) && $linha !== null;
    if (!$certa) {
        registrarTentativaErrada($chave, $ip);
        $espera = minutosDeBloqueio($chave, $ip);
        if ($espera > 0) {
            responder(429, ['ok' => false, 'erro' => "Muitas tentativas. Tente de novo em {$espera} minutos."]);
            return;
        }
        $restam = tentativasRestantes($chave);
        responder(401, ['ok' => false, 'erro' => $restam === null ? 'E-mail ou senha incorretos.'
            : "E-mail ou senha incorretos. Restam {$restam} tentativa(s) antes de bloquear por " . LOGIN_BLOQUEIO_MIN . ' minutos.']);
        return;
    }
    limparTentativas($chave);
    executarSql('UPDATE loja_contas SET ultimo_acesso = ? WHERE id = ?', [agora(), $linha['id']]);
    abrirSessaoLoja((int) $linha['id']);
    responder(200, ['ok' => true, 'conta' => contaParaTela($linha)]);
}

// ------------------------------------------------------------------
// Enderecos da conta
// ------------------------------------------------------------------
function enderecosDaConta(array $conta, ?int $id, string $metodo, array $corpo): array
{
    if ($metodo === 'GET' && $id === null) {
        return [200, ['ok' => true, 'itens' => consultar('SELECT * FROM loja_enderecos WHERE conta_id = ? ORDER BY id DESC', [$conta['id']])]];
    }
    if ($metodo === 'POST' && $id === null) {
        $novo = salvarEndereco((int) $conta['id'], enderecoDoCorpo($corpo));
        return [201, ['ok' => true, 'id' => $novo, 'mensagem' => 'Endereço guardado.']];
    }
    if ($metodo === 'DELETE' && $id !== null) {
        if (!executarSql('DELETE FROM loja_enderecos WHERE id = ? AND conta_id = ?', [$id, $conta['id']])) {
            throw new ErroApi(404, 'Endereço não encontrado.');
        }
        return [200, ['ok' => true, 'mensagem' => 'Endereço apagado. As encomendas já feitas continuam com o endereço delas.']];
    }
    throw new ErroApi(405, 'Método não permitido para esta rota.');
}

/** Guarda o endereco (o mesmo endereco de novo nao repete: devolve o que ja existe). */
function salvarEndereco(int $contaId, array $e): int
{
    $igual = consultarUm('SELECT id FROM loja_enderecos WHERE conta_id = ? AND cep = ? AND minusculas(logradouro) = minusculas(?)
                            AND minusculas(numero) = minusculas(?) AND COALESCE(minusculas(complemento), \'\') = COALESCE(minusculas(?), \'\')
                            AND minusculas(destinatario) = minusculas(?)',
                         [$contaId, $e['cep'], $e['logradouro'], $e['numero'], $e['complemento'], $e['destinatario']]);
    if ($igual) {
        return (int) $igual['id'];
    }
    executarSql('INSERT INTO loja_enderecos (conta_id, destinatario, cep, logradouro, numero, complemento, bairro, cidade, uf)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$contaId, $e['destinatario'], $e['cep'], $e['logradouro'], $e['numero'], $e['complemento'], $e['bairro'], $e['cidade'], $e['uf']]);
    return (int) banco()->lastInsertId();
}

// ------------------------------------------------------------------
// Encomendas do cliente
// ------------------------------------------------------------------
function encomendasDoCliente(array $conta, ?int $id, ?string $acao, string $metodo, array $corpo): array
{
    expirarEncomendas();
    if ($metodo === 'GET' && $id === null) {
        $lista = consultar('SELECT * FROM encomendas WHERE conta_id = ? ORDER BY criado_em DESC, id DESC', [$conta['id']]);
        return [200, ['ok' => true, 'itens' => array_map(fn ($e) => resumoEncomenda($e), $lista)]];
    }
    if ($metodo === 'GET' && $id !== null && $acao === null) {
        return [200, ['ok' => true, 'encomenda' => detalheEncomenda(encomendaDaConta($conta, $id), false)]];
    }
    if ($metodo === 'POST' && $id === null) {
        return criarEncomenda($conta, $corpo);
    }
    if ($metodo === 'POST' && $id !== null && $acao === 'cancelar') {
        $e = encomendaDaConta($conta, $id);
        if ($e['status'] !== 'aguardando_pagamento') {
            throw new ErroApi(400, 'Esta encomenda já está "' . rotuloDe('status_encomenda', $e['status']) . '" e não pode mais ser '
                . 'cancelada por aqui. Fale com a loja.');
        }
        emTransacao(function () use ($e) {
            executarSql("UPDATE encomendas SET status = 'cancelada', motivo_cancelamento = ?, atualizado_em = ? WHERE id = ?",
                        ['Cancelada pelo cliente.', agora(), $e['id']]);
            registrarEvento((int) $e['id'], 'cancelada', null, 'Cancelada pelo cliente.', null);
        });
        return [200, ['ok' => true, 'mensagem' => 'Encomenda cancelada. Nada foi cobrado.']];
    }
    throw new ErroApi(405, 'Método não permitido para esta rota.');
}

/** A encomenda, se for desta conta (de outra conta: 404, igual a "nao existe"). */
function encomendaDaConta(array $conta, int $id): array
{
    $e = consultarUm('SELECT * FROM encomendas WHERE id = ? AND conta_id = ?', [$id, $conta['id']]);
    if (!$e) {
        throw new ErroApi(404, 'Encomenda não encontrada.');
    }
    return $e;
}

function criarEncomenda(array $conta, array $corpo): array
{
    $ajustes = ajustesLoja();
    if ((int) $ajustes['aberta'] !== 1) {
        throw new ErroApi(400, 'A loja online não está aceitando encomendas agora. Tente mais tarde.');
    }
    $itens = $corpo['itens'] ?? null;
    if (!is_array($itens) || !$itens) {
        throw new ErroApi(400, 'O carrinho está vazio.');
    }
    if (count($itens) > LOJA_ITENS_MAX) {
        throw new ErroApi(400, 'Uma encomenda leva no máximo ' . LOJA_ITENS_MAX . ' produtos diferentes.');
    }

    // Junta as linhas do mesmo anuncio (o carrinho pode mandar repetido).
    $pedido = [];
    foreach ($itens as $item) {
        if (!is_array($item)) {
            throw new ErroApi(400, 'Item do carrinho inválido.');
        }
        $anuncioId = inteiro($item, 'anuncio_id', 'Produto', 1, PHP_INT_MAX, null);
        if (!$anuncioId) {
            throw new ErroApi(400, 'Item do carrinho sem produto.');
        }
        $pedido[$anuncioId] = ($pedido[$anuncioId] ?? 0) + (int) inteiro($item, 'quantidade', 'Quantidade', 1, LOJA_QUANTIDADE_MAX, 1);
    }
    $linhas = [];
    foreach ($pedido as $anuncioId => $quantidade) {
        $a = consultarUm(SQL_ANUNCIOS . ' WHERE a.id = ? AND a.publicado = 1', [$anuncioId]);
        if (!$a) {
            throw new ErroApi(400, 'Um produto do carrinho saiu da vitrine. Tire-o do carrinho e tente de novo.');
        }
        $a = prepararAnuncio($a);
        if ($quantidade > LOJA_QUANTIDADE_MAX) {
            throw new ErroApi(400, 'De "' . $a['titulo'] . '" dá para levar no máximo ' . LOJA_QUANTIDADE_MAX . ' unidades.');
        }
        if ($a['tipo'] === 'celular' && $quantidade > 1) {
            throw new ErroApi(400, '"' . $a['titulo'] . '" é um aparelho só: a quantidade é 1.');
        }
        $linhas[] = ['anuncio_id' => $anuncioId, 'entrada_id' => $a['entrada_id'], 'descricao' => $a['titulo'],
                     'quantidade' => $quantidade, 'unitario' => $a['preco'], 'subtotal' => round($a['preco'] * $quantidade, 2)];
    }

    $enderecoId = idDoCatalogo($corpo, 'endereco_id', null);
    if ($enderecoId) {
        $end = consultarUm('SELECT * FROM loja_enderecos WHERE id = ? AND conta_id = ?', [$enderecoId, $conta['id']]);
        if (!$end) {
            throw new ErroApi(400, 'Escolha um endereço de entrega da sua conta.');
        }
    } elseif (is_array($corpo['endereco'] ?? null)) {
        $end = enderecoDoCorpo($corpo['endereco']);
    } else {
        throw new ErroApi(400, 'Informe o endereço de entrega.');
    }
    $telefone = telefoneDoCorpo($corpo, 'telefone', false) ?? $conta['telefone'];
    $observacoes = textoCurto($corpo, 'observacoes', 'Observação', 300);

    $produtos = round(array_sum(array_column($linhas, 'subtotal')), 2);
    $frete = freteDe($produtos, $ajustes);
    $total = round($produtos + $frete, 2);
    conferirTeto($total, 'O total da encomenda');
    $pagarAte = date('Y-m-d H:i:s', time() + (int) $ajustes['prazo_pagamento_horas'] * 3600);

    expirarEncomendas();
    return emTransacao(function () use ($conta, $end, $enderecoId, $linhas, $produtos, $frete, $total, $pagarAte, $telefone, $observacoes) {
        if (!$enderecoId) {
            salvarEndereco((int) $conta['id'], $end);
        }
        $numero = proximoNumero('encomendas', 'LJ');
        executarSql(
            'INSERT INTO encomendas (numero, conta_id, valor_produtos, frete, valor_total, entrega_destinatario, entrega_cep,
                                     entrega_logradouro, entrega_numero, entrega_complemento, entrega_bairro, entrega_cidade,
                                     entrega_uf, entrega_telefone, observacoes, pagar_ate, criado_em, atualizado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$numero, $conta['id'], $produtos, $frete, $total, $end['destinatario'], $end['cep'], $end['logradouro'], $end['numero'],
             $end['complemento'], $end['bairro'], $end['cidade'], $end['uf'], $telefone, $observacoes, $pagarAte, agora(), agora()]);
        $id = (int) banco()->lastInsertId();
        foreach ($linhas as $l) {
            executarSql('INSERT INTO encomenda_itens (encomenda_id, anuncio_id, entrada_id, descricao, quantidade, valor_unitario, subtotal)
                         VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [$id, $l['anuncio_id'], $l['entrada_id'], $l['descricao'], $l['quantidade'], $l['unitario'], $l['subtotal']]);
        }
        registrarEvento($id, 'aguardando_pagamento', null, 'Encomenda recebida. Assim que o pagamento for confirmado, a loja separa o produto.', null);

        // Conferido DEPOIS de gravar (a reserva desta encomenda ja conta): duas
        // pessoas encomendando o ultimo celular ao mesmo tempo nao levam as duas.
        foreach ($linhas as $l) {
            $item = consultarUm('SELECT item, saldo, tipo, situacao FROM vw_entradas WHERE id = ?', [$l['entrada_id']]);
            $saldo = $item['tipo'] === 'celular' && $item['situacao'] === 'vendido' ? 0 : (int) $item['saldo'];
            if (reservadoNaLoja((int) $l['entrada_id']) > $saldo) {
                $sobra = max(0, $saldo - (reservadoNaLoja((int) $l['entrada_id']) - $l['quantidade']));
                throw new ErroApi(400, $sobra > 0
                    ? 'De "' . $l['descricao'] . '" só restam ' . $sobra . ' unidade(s). Ajuste a quantidade no carrinho.'
                    : '"' . $l['descricao'] . '" acabou de esgotar. Tire-o do carrinho para continuar.');
            }
        }
        return [201, ['ok' => true, 'id' => $id, 'numero' => $numero,
                      'mensagem' => 'Encomenda ' . $numero . ' registrada. Pague até ' . date('d/m/Y \à\s H:i', strtotime($pagarAte)) . '.']];
    });
}

/** Uma linha da lista "Minhas encomendas" (e da lista do administrador). */
function resumoEncomenda(array $e): array
{
    $itens = consultar('SELECT descricao, quantidade FROM encomenda_itens WHERE encomenda_id = ? ORDER BY id', [$e['id']]);
    return ['id' => (int) $e['id'], 'numero' => $e['numero'], 'status' => $e['status'],
            'status_rotulo' => rotuloDe('status_encomenda', $e['status']),
            'valor_total' => (float) $e['valor_total'], 'criado_em' => $e['criado_em'], 'pagar_ate' => $e['pagar_ate'],
            'previsao_entrega' => $e['previsao_entrega'], 'atualizado_em' => $e['atualizado_em'],
            'itens_texto' => implode(', ', array_map(fn ($i) => ($i['quantidade'] > 1 ? $i['quantidade'] . 'x ' : '') . $i['descricao'], $itens)),
            'entrega_cidade' => $e['entrega_cidade'], 'entrega_uf' => $e['entrega_uf']];
}

/*
 * A encomenda inteira: itens, endereco, o pagamento (enquanto aguarda) e o
 * RASTREIO - a trilha de passos, com a hora em que cada um aconteceu, e os
 * eventos com local e observacao. $admin junta quem fez cada passo, a conta
 * e a venda gerada.
 */
function detalheEncomenda(array $e, bool $admin): array
{
    $ajustes = ajustesLoja();
    $saida = resumoEncomenda($e) + [
        'valor_produtos' => (float) $e['valor_produtos'], 'frete' => (float) $e['frete'],
        'observacoes' => $e['observacoes'], 'transportadora' => $e['transportadora'], 'codigo_rastreio' => $e['codigo_rastreio'],
        'motivo_cancelamento' => $e['motivo_cancelamento'],
        'entrega' => ['destinatario' => $e['entrega_destinatario'], 'cep' => cepFormatado($e['entrega_cep']),
                      'logradouro' => $e['entrega_logradouro'], 'numero' => $e['entrega_numero'],
                      'complemento' => $e['entrega_complemento'], 'bairro' => $e['entrega_bairro'],
                      'cidade' => $e['entrega_cidade'], 'uf' => $e['entrega_uf'], 'telefone' => $e['entrega_telefone']],
        'origem' => $ajustes['cidade_origem'] ?: nomeDaVitrine($ajustes),
    ];
    $saida['itens'] = array_map(function ($i) {
        $foto = $i['anuncio_id'] ? consultarUm('SELECT id FROM anuncio_fotos WHERE anuncio_id = ? ORDER BY ordem, id LIMIT 1', [$i['anuncio_id']]) : null;
        return ['descricao' => $i['descricao'], 'quantidade' => (int) $i['quantidade'], 'valor_unitario' => (float) $i['valor_unitario'],
                'subtotal' => (float) $i['subtotal'], 'anuncio_id' => $i['anuncio_id'] === null ? null : (int) $i['anuncio_id'],
                'foto' => $foto ? (int) $foto['id'] : null, 'entrada_id' => (int) $i['entrada_id']];
    }, consultar('SELECT * FROM encomenda_itens WHERE encomenda_id = ? ORDER BY id', [$e['id']]));
    if (!$admin) {
        $saida['itens'] = array_map(function ($i) { unset($i['entrada_id']); return $i; }, $saida['itens']);
    }

    $eventos = consultar('SELECT ev.*, u.nome AS usuario FROM encomenda_eventos ev LEFT JOIN usuarios u ON u.id = ev.usuario_id
                           WHERE ev.encomenda_id = ? ORDER BY ev.id', [$e['id']]);
    $saida['eventos'] = array_map(function ($ev) use ($admin) {
        $linha = ['status' => $ev['status'], 'rotulo' => rotuloDe('status_encomenda', $ev['status']), 'momento' => $ev['momento'],
                  'local' => $ev['local'], 'observacao' => $ev['observacao']];
        if ($admin) {
            $linha['usuario'] = $ev['usuario'];
        }
        return $linha;
    }, array_reverse($eventos));   // o mais novo em cima

    // A trilha: cada passo com a hora do PRIMEIRO evento dele.
    $quando = [];
    foreach ($eventos as $ev) {
        $quando[$ev['status']] = $quando[$ev['status']] ?? $ev['momento'];
    }
    $posicao = array_search($e['status'], STATUS_ENCOMENDA_TRILHA, true);
    $saida['trilha'] = array_map(fn ($s, $i) => ['status' => $s, 'rotulo' => rotuloDe('status_encomenda', $s),
        'momento' => $quando[$s] ?? null, 'feito' => $posicao !== false && $i <= $posicao, 'atual' => $posicao === $i],
        STATUS_ENCOMENDA_TRILHA, array_keys(STATUS_ENCOMENDA_TRILHA));
    // Pago em diante: a encomenda tem rastreio (antes disso, a tela mostra o pagamento).
    $saida['rastreio'] = $posicao !== false && $posicao >= 1;
    $saida['proximo'] = $posicao !== false && $posicao + 1 < count(STATUS_ENCOMENDA_TRILHA) ? STATUS_ENCOMENDA_TRILHA[$posicao + 1] : null;
    $saida['proximo_rotulo'] = $saida['proximo'] ? rotuloDe('status_encomenda', $saida['proximo']) : null;
    $saida['pode_cancelar'] = $e['status'] === 'aguardando_pagamento' || ($admin && !in_array($e['status'], ['entregue', 'cancelada'], true));

    if ($e['status'] === 'aguardando_pagamento') {
        $saida['pagamento'] = ['forma' => 'Pix', 'chave_pix' => $ajustes['chave_pix'], 'recebedor' => $ajustes['recebedor_pix'],
                               'valor' => (float) $e['valor_total'], 'pagar_ate' => $e['pagar_ate']];
    }
    if ($admin) {
        $conta = consultarUm('SELECT id, nome, email, telefone, cpf, cliente_id FROM loja_contas WHERE id = ?', [$e['conta_id']]);
        $saida['conta'] = $conta;
        $saida['venda'] = $e['venda_id'] ? consultarUm('SELECT id, numero, status FROM vendas WHERE id = ?', [$e['venda_id']]) : null;
    }
    return $saida;
}

// ------------------------------------------------------------------
// Administrador: encomendas
// ------------------------------------------------------------------
function encomendasAdmin(?int $id, ?string $acao, string $metodo, array $corpo, array $consulta, array $usuario): array
{
    expirarEncomendas();
    if ($metodo === 'GET' && $acao === null) {
        if ($id !== null) {
            $e = consultarUm('SELECT * FROM encomendas WHERE id = ?', [$id]);
            if (!$e) {
                throw new ErroApi(404, 'Encomenda não encontrada.');
            }
            return [200, ['ok' => true, 'encomenda' => detalheEncomenda($e, true)]];
        }
        $status = is_string($consulta['status'] ?? null) ? $consulta['status'] : '';
        $filtro = in_array($status, valoresDe('status_encomenda'), true) ? ' WHERE e.status = ?' : '';
        $lista = consultar('SELECT e.*, c.nome AS cliente, c.email, c.telefone FROM encomendas e JOIN loja_contas c ON c.id = e.conta_id'
                           . $filtro . ' ORDER BY e.criado_em DESC, e.id DESC', $filtro ? [$status] : []);
        $contagem = [];
        foreach (consultar('SELECT status, COUNT(*) AS q FROM encomendas GROUP BY status') as $c) {
            $contagem[$c['status']] = (int) $c['q'];
        }
        return [200, ['ok' => true, 'contagem' => $contagem, 'itens' => array_map(fn ($e) => resumoEncomenda($e) + [
            'cliente' => $e['cliente'], 'email' => $e['email'], 'telefone' => $e['telefone']], $lista)]];
    }
    exigir($metodo === 'POST' && $id !== null);
    switch ($acao) {
        case 'pagamento':
            return confirmarPagamento($id, $corpo, $usuario);
        case 'avancar':
            return avancarEncomenda($id, $corpo, $usuario);
        case 'cancelar':
            return cancelarEncomenda($id, $corpo, $usuario);
    }
    throw new ErroApi(404, 'Rota não encontrada.');
}

/** A forma "Pix" do cadastro (a venda da loja online e sempre no Pix). */
function formaPix(): array
{
    $f = consultarUm("SELECT id, nome FROM formas_pagamento WHERE minusculas(nome) = 'pix' ORDER BY ativo DESC, id LIMIT 1");
    return $f ? [(int) $f['id'], (string) $f['nome']] : [null, 'Pix'];
}

/*
 * O cliente da loja vira cliente do cadastro no primeiro pagamento (e e ele
 * que aparece na venda e no financeiro). Cadastro apagado depois: nasce outro.
 */
function clienteDaConta(array $conta, array $e): int
{
    if ($conta['cliente_id'] && consultarUm('SELECT id FROM clientes WHERE id = ?', [$conta['cliente_id']])) {
        return (int) $conta['cliente_id'];
    }
    $endereco = $e['entrega_logradouro'] . ', ' . $e['entrega_numero'] . ($e['entrega_complemento'] ? ' - ' . $e['entrega_complemento'] : '')
              . ' - ' . $e['entrega_bairro'] . ' - ' . $e['entrega_cidade'] . '/' . $e['entrega_uf'] . ' - CEP ' . cepFormatado($e['entrega_cep']);
    executarSql('INSERT INTO clientes (nome, telefone, documento, email, endereco, observacoes) VALUES (?, ?, ?, ?, ?, ?)',
                [$conta['nome'], $conta['telefone'], $conta['cpf'], $conta['email'], $endereco, 'Cliente da loja online.']);
    $clienteId = (int) banco()->lastInsertId();
    executarSql('UPDATE loja_contas SET cliente_id = ? WHERE id = ?', [$clienteId, $conta['id']]);
    return $clienteId;
}

/** Encomenda pelo id, ou 404. */
function encomendaParaMudar(int $id): array
{
    $e = consultarUm('SELECT * FROM encomendas WHERE id = ?', [$id]);
    if (!$e) {
        throw new ErroApi(404, 'Encomenda não encontrada.');
    }
    return $e;
}

function confirmarPagamento(int $id, array $corpo, array $usuario): array
{
    $observacao = textoCurto($corpo, 'observacao', 'Observação', 300);
    return emTransacao(function () use ($id, $observacao, $usuario) {
        $e = encomendaParaMudar($id);
        if ($e['status'] !== 'aguardando_pagamento') {
            throw new ErroApi(409, $e['status'] === 'cancelada'
                ? 'Esta encomenda está cancelada (' . ($e['motivo_cancelamento'] ?: 'sem motivo') . '). Peça ao cliente para encomendar de novo.'
                : 'O pagamento desta encomenda já foi confirmado (agora ela está "' . rotuloDe('status_encomenda', $e['status']) . '").');
        }
        $conta = consultarUm('SELECT * FROM loja_contas WHERE id = ?', [$e['conta_id']]);
        $clienteId = clienteDaConta($conta, $e);

        $linhas = array_map(function ($i) {
            $custo = (float) (consultarUm('SELECT valor_investimento FROM entradas WHERE id = ?', [$i['entrada_id']])['valor_investimento'] ?? 0);
            return ['entrada_id' => (int) $i['entrada_id'], 'descricao' => $i['descricao'], 'quantidade' => (int) $i['quantidade'],
                    'unitario' => (float) $i['valor_unitario'], 'custo' => $custo, 'subtotal' => (float) $i['subtotal']];
        }, consultar('SELECT * FROM encomenda_itens WHERE encomenda_id = ? ORDER BY id', [$id]));
        if ((float) $e['frete'] > 0) {
            $linhas[] = ['entrada_id' => null, 'descricao' => 'Frete da encomenda ' . $e['numero'], 'quantidade' => 1,
                         'unitario' => (float) $e['frete'], 'custo' => 0.0, 'subtotal' => (float) $e['frete']];
        }
        $total = (float) $e['valor_total'];
        $custo = round(array_sum(array_map(fn ($l) => $l['custo'] * $l['quantidade'], $linhas)), 2);
        [$formaId, $forma] = formaPix();
        $data = agora();

        // A reserva desta encomenda sai antes de baixar (senao o item contaria duas vezes).
        executarSql("UPDATE encomendas SET status = 'pago', atualizado_em = ? WHERE id = ?", [$data, $id]);
        $vendaId = gravarVenda(['cliente_id' => $clienteId, 'usuario_id' => $usuario['id'], 'bruto' => $total, 'desconto' => 0.0,
            'total' => $total, 'custo' => $custo, 'forma' => $forma, 'forma_id' => $formaId, 'parcelas' => 1, 'data' => $data,
            'observacoes' => 'Loja online: encomenda ' . $e['numero']], $linhas);
        conferirSaldos(array_column($linhas, 'entrada_id'),
            'Algum item foi vendido no balcão depois da encomenda. Cancele a encomenda (o cliente é avisado no rastreio) ou dê entrada no item.');
        gerarLancamentosDaVenda($vendaId, $total, 1, $forma, $formaId, $clienteId, substr($data, 0, 10), (int) $usuario['id'], true);

        $dias = (int) ajustesLoja()['prazo_entrega_dias'];
        executarSql('UPDATE encomendas SET venda_id = ?, previsao_entrega = ? WHERE id = ?',
                    [$vendaId, date('Y-m-d', strtotime(substr($data, 0, 10) . " +{$dias} days")), $id]);
        registrarEvento($id, 'pago', null, $observacao ?? 'Pagamento confirmado pela loja.', (int) $usuario['id']);
        $numeroVenda = consultarUm('SELECT numero FROM vendas WHERE id = ?', [$vendaId])['numero'];
        return [200, ['ok' => true, 'venda_id' => $vendaId,
                      'mensagem' => 'Pagamento confirmado. Venda ' . $numeroVenda . ' registrada e o estoque baixado.']];
    });
}

function avancarEncomenda(int $id, array $corpo, array $usuario): array
{
    $local = textoCurto($corpo, 'local', 'Local', 120);
    $observacao = textoCurto($corpo, 'observacao', 'Observação', 300);
    $transportadora = textoCurto($corpo, 'transportadora', 'Transportadora', 60);
    $codigo = textoCurto($corpo, 'codigo_rastreio', 'Código de rastreio', 40);
    $para = txt($corpo, 'para');
    return emTransacao(function () use ($id, $local, $observacao, $transportadora, $codigo, $para, $usuario) {
        $e = encomendaParaMudar($id);
        $posicao = array_search($e['status'], STATUS_ENCOMENDA_TRILHA, true);
        if ($e['status'] === 'aguardando_pagamento') {
            throw new ErroApi(400, 'Confirme o pagamento primeiro: a entrega só anda depois dele.');
        }
        if ($posicao === false || $posicao + 1 >= count(STATUS_ENCOMENDA_TRILHA)) {
            throw new ErroApi(400, 'Esta encomenda já está "' . rotuloDe('status_encomenda', $e['status']) . '": não há próximo passo.');
        }
        $proximo = STATUS_ENCOMENDA_TRILHA[$posicao + 1];
        // Clique duplo, ou duas abas: o passo que a tela mostrou tem de ser o que vem agora.
        if ($para !== null && $para !== $proximo) {
            throw new ErroApi(409, 'A encomenda já está "' . rotuloDe('status_encomenda', $e['status']) . '" (alguém avançou antes). '
                . 'A lista foi atualizada; confira antes de avançar de novo.');
        }
        executarSql('UPDATE encomendas SET status = ?, transportadora = COALESCE(?, transportadora),
                                           codigo_rastreio = COALESCE(?, codigo_rastreio), atualizado_em = ? WHERE id = ?',
                    [$proximo, $transportadora, $codigo, agora(), $id]);
        $padrao = ['separacao' => 'A loja está separando e embalando o seu produto.',
                   'enviado' => 'O pacote saiu da loja.', 'em_transito' => 'O pacote está a caminho da sua cidade.',
                   'saiu_entrega' => 'O pacote saiu para entrega no seu endereço.', 'entregue' => 'Entregue no endereço informado.'];
        registrarEvento($id, $proximo, $local, $observacao ?? ($padrao[$proximo] ?? null), (int) $usuario['id']);
        return [200, ['ok' => true, 'status' => $proximo,
                      'mensagem' => 'Encomenda ' . $e['numero'] . ': ' . rotuloDe('status_encomenda', $proximo) . '.']];
    });
}

function cancelarEncomenda(int $id, array $corpo, array $usuario): array
{
    $motivo = textoCurto($corpo, 'motivo', 'Motivo', 300, true);
    return emTransacao(function () use ($id, $motivo, $usuario) {
        $e = encomendaParaMudar($id);
        if (in_array($e['status'], ['entregue', 'cancelada'], true)) {
            throw new ErroApi(400, 'Encomenda "' . rotuloDe('status_encomenda', $e['status']) . '" não pode ser cancelada.');
        }
        $mensagem = 'Encomenda ' . $e['numero'] . ' cancelada.';
        if ($e['venda_id']) {
            // Ja paga: a venda cai junto (o estoque volta e o recebido vira estorno), pela regra da venda.
            atualizarVenda((int) $e['venda_id'], ['status' => 'cancelada'], $usuario, true);
            $mensagem .= ' A venda foi cancelada, o item voltou ao estoque e o valor recebido foi estornado no Financeiro: '
                       . 'devolva o dinheiro ao cliente.';
        }
        executarSql("UPDATE encomendas SET status = 'cancelada', motivo_cancelamento = ?, atualizado_em = ? WHERE id = ?",
                    [$motivo, agora(), $id]);
        registrarEvento($id, 'cancelada', null, $motivo, (int) $usuario['id']);
        return [200, ['ok' => true, 'mensagem' => $mensagem]];
    });
}

// ------------------------------------------------------------------
// Administrador: anuncios e fotos
// ------------------------------------------------------------------
function anuncios(?int $id, string $metodo, array $corpo, array $usuario): array
{
    if ($metodo === 'GET') {
        if ($id !== null) {
            $a = consultarUm(SQL_ANUNCIOS . ' WHERE a.id = ?', [$id]);
            if (!$a) {
                throw new ErroApi(404, 'Anúncio não encontrado.');
            }
            return [200, ['ok' => true, 'anuncio' => anuncioParaAdmin(prepararAnuncio($a))]];
        }
        return [200, ['ok' => true, 'itens' => array_map(fn ($a) => anuncioParaAdmin(prepararAnuncio($a)),
            consultar(SQL_ANUNCIOS . ' ORDER BY a.publicado DESC, a.atualizado_em DESC, a.id DESC'))]];
    }
    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        if (!consultarUm('SELECT id FROM anuncios WHERE id = ?', [$id])) {
            throw new ErroApi(404, 'Anúncio não encontrado.');
        }
        if (consultarUm('SELECT id FROM encomenda_itens WHERE anuncio_id = ? LIMIT 1', [$id])) {
            throw new ErroApi(400, 'Este anúncio já tem encomendas. Para ele sair da vitrine, desligue "Publicado" em vez de excluir.');
        }
        executarSql('DELETE FROM anuncios WHERE id = ?', [$id]);
        return [200, ['ok' => true, 'mensagem' => 'Anúncio excluído.']];
    }
    exigir($metodo === 'POST' || $metodo === 'PUT');
    $atual = null;
    if ($metodo === 'PUT') {
        $id = exigirId($id);
        $atual = consultarUm('SELECT * FROM anuncios WHERE id = ?', [$id]);
        if (!$atual) {
            throw new ErroApi(404, 'Anúncio não encontrado.');
        }
    }

    $entradaId = array_key_exists('entrada_id', $corpo) ? idDoCatalogo($corpo, 'entrada_id', null) : ($atual ? (int) $atual['entrada_id'] : null);
    if (!$entradaId) {
        throw new ErroApi(400, 'Escolha o item do estoque que este anúncio vende.');
    }
    $entrada = consultarUm('SELECT * FROM vw_entradas WHERE id = ?', [$entradaId]);
    if (!$entrada) {
        throw new ErroApi(400, 'Item do estoque não encontrado (entrada #' . $entradaId . ').');
    }
    $trocouItem = !$atual || (int) $atual['entrada_id'] !== $entradaId;
    if ($trocouItem && ((int) $entrada['saldo'] <= 0 || ($entrada['tipo'] === 'celular' && $entrada['situacao'] === 'vendido'))) {
        throw new ErroApi(400, '"' . $entrada['item'] . '" não tem saldo no estoque: não dá para anunciar.');
    }
    $titulo = array_key_exists('titulo', $corpo) ? textoCurto($corpo, 'titulo', 'Título', 120) : ($atual['titulo'] ?? null);
    $titulo = $titulo ?? (string) $entrada['item'];
    $descricao = array_key_exists('descricao', $corpo) ? textoCurto($corpo, 'descricao', 'Descrição', 2000) : ($atual['descricao'] ?? null);
    $preco = dinheiro($corpo, 'preco', 'Preço', $atual ? (float) $atual['preco'] : (float) $entrada['valor_venda']);
    if ($preco <= 0) {
        throw new ErroApi(400, 'Informe o preço da loja online (maior que zero).');
    }
    $publicado = array_key_exists('publicado', $corpo) ? (!empty($corpo['publicado']) && $corpo['publicado'] !== '0' ? 1 : 0)
                                                       : ($atual ? (int) $atual['publicado'] : 1);

    $novas = $corpo['fotos_novas'] ?? [];
    $remover = $corpo['fotos_remover'] ?? [];
    if (!is_array($novas) || !is_array($remover)) {
        throw new ErroApi(400, 'Fotos inválidas.');
    }
    $fotos = array_map('fotoDoCorpo', array_values($novas));   // confere tudo antes de gravar

    return emTransacao(function () use ($id, $atual, $entradaId, $titulo, $descricao, $preco, $publicado, $fotos, $remover, $usuario) {
        if ($atual) {
            executarSql('UPDATE anuncios SET entrada_id = ?, titulo = ?, descricao = ?, preco = ?, publicado = ?, atualizado_em = ?,
                                             usuario_id = ? WHERE id = ?',
                        [$entradaId, $titulo, $descricao, $preco, $publicado, agora(), $usuario['id'], $id]);
            foreach ($remover as $fotoId) {
                if (is_scalar($fotoId)) {
                    executarSql('DELETE FROM anuncio_fotos WHERE id = ? AND anuncio_id = ?', [(int) $fotoId, $id]);
                }
            }
        } else {
            executarSql('INSERT INTO anuncios (entrada_id, titulo, descricao, preco, publicado, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
                        [$entradaId, $titulo, $descricao, $preco, $publicado, $usuario['id']]);
            $id = (int) banco()->lastInsertId();
        }
        $ja = (int) consultarUm('SELECT COUNT(*) AS q FROM anuncio_fotos WHERE anuncio_id = ?', [$id])['q'];
        if ($ja + count($fotos) > LOJA_FOTOS_MAX) {
            throw new ErroApi(400, 'Cada anúncio leva no máximo ' . LOJA_FOTOS_MAX . ' fotos (este ficaria com ' . ($ja + count($fotos)) . ').');
        }
        $ordem = (int) consultarUm('SELECT COALESCE(MAX(ordem), 0) AS o FROM anuncio_fotos WHERE anuncio_id = ?', [$id])['o'];
        $st = banco()->prepare('INSERT INTO anuncio_fotos (anuncio_id, ordem, tipo, dados) VALUES (?, ?, ?, ?)');
        foreach ($fotos as [$tipo, $bytes]) {
            $ordem++;
            $st->bindValue(1, $id, PDO::PARAM_INT);
            $st->bindValue(2, $ordem, PDO::PARAM_INT);
            $st->bindValue(3, $tipo);
            $st->bindValue(4, $bytes, PDO::PARAM_LOB);
            $st->execute();
        }
        return [$atual ? 200 : 201, ['ok' => true, 'id' => $id,
                'mensagem' => $atual ? 'Anúncio atualizado.' : ($publicado ? 'Anúncio publicado na vitrine.' : 'Anúncio guardado (fora da vitrine).')]];
    });
}

function anuncioParaAdmin(array $a): array
{
    $a['tipo_rotulo'] = rotuloDe('tipos_entrada', $a['tipo']);
    $a['situacao_rotulo'] = rotuloDe('situacoes', $a['situacao']);
    $a['vendidos'] = (int) consultarUm(
        "SELECT COALESCE(SUM(ei.quantidade), 0) AS q FROM encomenda_itens ei JOIN encomendas en ON en.id = ei.encomenda_id
          WHERE ei.anuncio_id = ? AND en.status NOT IN ('aguardando_pagamento', 'cancelada')", [$a['id']])['q'];
    return $a;
}

/** Foto que veio como data URL: tipo e tamanho conferidos pelo CONTEUDO, nao pelo nome. */
function fotoDoCorpo($valor): array
{
    if (!is_string($valor) || !preg_match('#^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$#', $valor, $m)) {
        throw new ErroApi(400, 'A foto precisa ser JPG, PNG ou WEBP.');
    }
    $bytes = base64_decode($m[2], true);
    if ($bytes === false || $bytes === '') {
        throw new ErroApi(400, 'Não consegui ler a foto. Escolha o arquivo de novo.');
    }
    if (strlen($bytes) > LOJA_FOTO_BYTES_MAX) {
        throw new ErroApi(400, 'A foto passou de 1 MB. Use uma foto menor.');
    }
    $info = @getimagesizefromstring($bytes);
    if (!$info || !in_array($info['mime'] ?? '', ['image/jpeg', 'image/png', 'image/webp'], true) || $info[0] > 8000 || $info[1] > 8000) {
        throw new ErroApi(400, 'O arquivo não é uma foto JPG, PNG ou WEBP válida.');
    }
    return [$info['mime'], $bytes];
}

function fotoAnuncioAdmin(?int $id): void
{
    enviarFoto(consultarUm('SELECT tipo, dados FROM anuncio_fotos WHERE id = ?', [exigirId($id)]));
}

// ------------------------------------------------------------------
// Administrador: ajustes da loja online
// ------------------------------------------------------------------
function ajustesDaLoja(?int $id, string $metodo, array $corpo, array $usuario): array
{
    if ($id !== null) {
        throw new ErroApi(404, 'Rota não encontrada.');
    }
    $a = ajustesLoja();
    if ($metodo === 'GET') {
        return [200, ['ok' => true, 'ajustes' => ajustesParaTela($a)]];
    }
    exigir($metodo === 'PUT');
    $novo = [
        'aberta' => array_key_exists('aberta', $corpo) ? (!empty($corpo['aberta']) && $corpo['aberta'] !== '0' ? 1 : 0) : (int) $a['aberta'],
        'nome_vitrine' => array_key_exists('nome_vitrine', $corpo) ? textoCurto($corpo, 'nome_vitrine', 'Nome na vitrine', 80) : $a['nome_vitrine'],
        'frete_fixo' => dinheiro($corpo, 'frete_fixo', 'Frete', (float) $a['frete_fixo']),
        'frete_gratis_acima' => dinheiro($corpo, 'frete_gratis_acima', 'Frete grátis a partir de', (float) $a['frete_gratis_acima']),
        'prazo_pagamento_horas' => inteiro($corpo, 'prazo_pagamento_horas', 'Prazo para pagar (horas)', 1, 720, (int) $a['prazo_pagamento_horas']),
        'prazo_entrega_dias' => inteiro($corpo, 'prazo_entrega_dias', 'Prazo de entrega (dias)', 1, 90, (int) $a['prazo_entrega_dias']),
        'chave_pix' => array_key_exists('chave_pix', $corpo) ? textoCurto($corpo, 'chave_pix', 'Chave PIX', 120) : $a['chave_pix'],
        'recebedor_pix' => array_key_exists('recebedor_pix', $corpo) ? textoCurto($corpo, 'recebedor_pix', 'Nome de quem recebe', 80) : $a['recebedor_pix'],
        'cidade_origem' => array_key_exists('cidade_origem', $corpo) ? textoCurto($corpo, 'cidade_origem', 'Cidade de onde sai', 80) : $a['cidade_origem'],
    ];
    if ($novo['aberta'] && !$novo['chave_pix']) {
        throw new ErroApi(400, 'Para abrir a loja online, informe a chave PIX: é por ela que o cliente paga.');
    }
    executarSql('UPDATE loja_ajustes SET aberta = ?, nome_vitrine = ?, frete_fixo = ?, frete_gratis_acima = ?, prazo_pagamento_horas = ?,
                        prazo_entrega_dias = ?, chave_pix = ?, recebedor_pix = ?, cidade_origem = ?, atualizado_em = ?, usuario_id = ?
                  WHERE id = 1',
                [$novo['aberta'], $novo['nome_vitrine'], $novo['frete_fixo'], $novo['frete_gratis_acima'], $novo['prazo_pagamento_horas'],
                 $novo['prazo_entrega_dias'], $novo['chave_pix'], $novo['recebedor_pix'], $novo['cidade_origem'], agora(), $usuario['id']]);
    return [200, ['ok' => true, 'ajustes' => ajustesParaTela(ajustesLoja()),
                  'mensagem' => $novo['aberta'] ? 'Ajustes gravados. A loja online está ABERTA para encomendas.'
                                                : 'Ajustes gravados. A loja online está FECHADA para encomendas (a vitrine continua no ar).']];
}

function ajustesParaTela(array $a): array
{
    return ['aberta' => (int) $a['aberta'] === 1, 'nome_vitrine' => $a['nome_vitrine'], 'nome' => nomeDaVitrine($a),
            'frete_fixo' => (float) $a['frete_fixo'], 'frete_gratis_acima' => (float) $a['frete_gratis_acima'],
            'prazo_pagamento_horas' => (int) $a['prazo_pagamento_horas'], 'prazo_entrega_dias' => (int) $a['prazo_entrega_dias'],
            'chave_pix' => $a['chave_pix'], 'recebedor_pix' => $a['recebedor_pix'], 'cidade_origem' => $a['cidade_origem'],
            'atualizado_em' => $a['atualizado_em']];
}
