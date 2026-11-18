<?php
/**
 * api/rotas/acesso.php - login (com limite de tentativas), troca de senha,
 * /config e cadastro de usuarios.
 */

declare(strict_types=1);

// ------------------------------------------------------------------
// Login
// ------------------------------------------------------------------
function login(array $corpo): void
{
    $usuario = txt($corpo, 'usuario');
    $senha   = $corpo['senha'] ?? '';
    if (!is_string($senha)) {
        $senha = '';
    }
    if ($usuario === null || $senha === '') {
        responder(400, ['ok' => false, 'erro' => 'Informe usuário e senha.']);
        return;
    }

    $login = mb_strtolower($usuario);
    $ip    = ipDoCliente();

    // Bloqueado: nem confere a senha. Senao o bloqueio so atrasaria o chute.
    $espera = minutosDeBloqueio($login, $ip);
    if ($espera > 0) {
        responder(429, ['ok' => false, 'erro' => "Muitas tentativas. Tente de novo em {$espera} minutos."]);
        return;
    }

    // Login que nao existe tambem roda o PBKDF2 (sobre um hash falso): o
    // tempo de resposta nao entrega quais logins existem.
    $linha = consultarUm('SELECT * FROM usuarios WHERE usuario = ? AND ativo = 1', [$login]);
    $certa = conferirSenha($senha, $linha['senha_hash'] ?? HASH_FALSO) && $linha !== null;
    if (!$certa) {
        registrarTentativaErrada($login, $ip);
        $espera = minutosDeBloqueio($login, $ip);
        if ($espera > 0) {
            responder(429, ['ok' => false, 'erro' => "Muitas tentativas. Tente de novo em {$espera} minutos."]);
            return;
        }
        $restam = tentativasRestantes($login);
        responder(401, ['ok' => false, 'restam' => $restam, 'erro' => $restam === null
            ? 'Usuário ou senha incorretos.'
            : "Usuário ou senha incorretos. Restam {$restam} tentativa(s) antes de bloquear por " . LOGIN_BLOQUEIO_MIN . ' minutos.']);
        return;
    }

    limparTentativas($login);
    executarSql("UPDATE usuarios SET ultimo_acesso = datetime('now', 'localtime') WHERE id = ?", [$linha['id']]);

    iniciarSessao();
    session_regenerate_id(true);
    $_SESSION['usuario_id']   = (int) $linha['id'];
    $_SESSION['login_em']     = time();
    // Troca obrigatoria: senha fraca, senha inicial da instalacao, ou senha
    // dada/redefinida pelo admin (usuarios.trocar_senha).
    // Excecao: no banco de teste (Empresa e regras > Regras > Sistema) a senha
    // fraca nao obriga a trocar, para o acesso rapido da demonstracao (p / p).
    // A API continua recusando senha fraca ao criar, redefinir e trocar: senha
    // assim so existe gravada direto no banco. Na loja a regra fica desligada.
    $_SESSION['trocar_senha'] = (senhaFraca($senha, (string) $linha['usuario']) !== null
                                    && !chaveLigada('sistema.banco_de_teste'))
                                || (int) ($linha['trocar_senha'] ?? 0) === 1;

    responder(200, ['ok' => true, 'usuario' => [
        'id'           => (int) $linha['id'],
        'usuario'      => $linha['usuario'],
        'nome'         => $linha['nome'],
        'perfil'       => $linha['perfil'],
        'trocar_senha' => $_SESSION['trocar_senha'],
    ]]);
}

/*
 * Bloqueio: LOGIN_MAX_ERROS erros no mesmo login dentro de 15 minutos
 * travam ESSE login por 15 minutos, contados do ultimo erro.
 *
 * Por IP so conta quando o IP nao e local, e com limite maior
 * (LOGIN_MAX_ERROS_IP): na loja, servidor e navegador ficam na mesma
 * maquina e todo mundo e 127.0.0.1 - contar por IP fazia o Caps Lock de
 * um funcionario trancar o dono do lado de fora.
 */
function minutosDeBloqueio(string $login, string $ip): int
{
    $resta = 0;
    $contas = [['usuario', $login, LOGIN_MAX_ERROS]];
    if (!ipLocal($ip)) {
        $contas[] = ['ip', $ip, LOGIN_MAX_ERROS_IP];
    }
    foreach ($contas as [$coluna, $valor, $limite]) {
        $resta = max($resta, segundosDeBloqueio($coluna, $valor, $limite));
    }
    return $resta > 0 ? (int) ceil($resta / 60) : 0;
}

/** Segundos que faltam de bloqueio para um login (ou IP); 0 = livre. */
function segundosDeBloqueio(string $coluna, string $valor, int $limite): int
{
    $janela = LOGIN_BLOQUEIO_MIN * 60;
    $ultimas = consultar(
        'SELECT momento FROM login_tentativas WHERE ' . ($coluna === 'ip' ? 'ip' : 'usuario') . ' = ?
          ORDER BY momento DESC, id DESC LIMIT ' . $limite, [$valor]);
    if (count($ultimas) < $limite) {
        return 0;
    }
    $ultima   = (int) $ultimas[0]['momento'];
    $primeira = (int) $ultimas[$limite - 1]['momento'];
    if ($ultima - $primeira <= $janela && time() - $ultima < $janela) {
        return $janela - (time() - $ultima);
    }
    return 0;
}

/* Quantas tentativas o login ainda tem; null antes da LOGIN_AVISO_A_PARTIR-esima. */
function tentativasRestantes(string $login): ?int
{
    $erros = (int) consultarUm('SELECT COUNT(*) AS q FROM login_tentativas WHERE usuario = ? AND momento > ?',
                               [$login, time() - LOGIN_BLOQUEIO_MIN * 60])['q'];
    return $erros >= LOGIN_AVISO_A_PARTIR ? max(0, LOGIN_MAX_ERROS - $erros) : null;
}

function registrarTentativaErrada(string $login, string $ip): void
{
    executarSql('INSERT INTO login_tentativas (usuario, ip, momento) VALUES (?, ?, ?)', [$login, $ip, time()]);
}

/*
 * Login certo zera as tentativas DAQUELE login - so dele. Zerar tambem
 * as do IP deixava qualquer funcionario chutar 4 senhas do admin, entrar
 * com a propria conta e recomecar sem fim.
 */
function limparTentativas(string $login): void
{
    executarSql('DELETE FROM login_tentativas WHERE usuario = ? OR momento < ?', [$login, time() - 86400]);
}

/** Ate quando um login esta bloqueado (data/hora), ou null. */
function bloqueadoAte(string $login): ?string
{
    $segundos = segundosDeBloqueio('usuario', $login, LOGIN_MAX_ERROS);
    return $segundos > 0 ? date('Y-m-d H:i:s', time() + $segundos) : null;
}

// ------------------------------------------------------------------
// Troca de senha e /config
// ------------------------------------------------------------------
function trocarSenha(array $corpo, array $usuario): array
{
    $atual = is_string($corpo['senha_atual'] ?? null) ? $corpo['senha_atual'] : '';
    $nova  = is_string($corpo['senha_nova'] ?? null) ? $corpo['senha_nova'] : '';
    $linha = consultarUm('SELECT usuario, senha_hash FROM usuarios WHERE id = ?', [$usuario['id']]);
    $login = (string) $linha['usuario'];

    // Errar a senha atual conta como tentativa de login: com uma sessao
    // aberta, ninguem adivinha a senha de outra pessoa sem limite.
    $espera = minutosDeBloqueio($login, ipDoCliente());
    if ($espera > 0) {
        throw new ErroApi(429, "Muitas tentativas. Tente de novo em {$espera} minutos.");
    }
    if (!conferirSenha($atual, $linha['senha_hash'])) {
        registrarTentativaErrada($login, ipDoCliente());
        $espera = minutosDeBloqueio($login, ipDoCliente());
        if ($espera > 0) {
            throw new ErroApi(429, "Muitas tentativas. Tente de novo em {$espera} minutos.");
        }
        $restam = tentativasRestantes($login);
        throw new ErroApi(400, 'A senha atual não confere.' . ($restam === null ? ''
            : " Restam {$restam} tentativa(s) antes de bloquear por " . LOGIN_BLOQUEIO_MIN . ' minutos.'),
            ['restam' => $restam]);
    }
    $fraca = senhaFraca($nova, $login);
    if ($fraca !== null) {
        throw new ErroApi(400, $fraca);
    }
    if (hash_equals($atual, $nova)) {
        throw new ErroApi(400, 'A senha nova precisa ser diferente da atual.');
    }
    executarSql('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?', [gerarHash($nova), $usuario['id']]);
    limparTentativas($login);
    $_SESSION['trocar_senha'] = false;
    return [200, ['ok' => true, 'mensagem' => 'Senha alterada com sucesso.']];
}

/** Um dominio no formato da tela: [{valor, rotulo}] (motivos com lado). */
function dominioParaTela(string $nome): array
{
    $saida = [];
    foreach (DOMINIOS[$nome] as $valor => $r) {
        $valor = (string) $valor;
        $saida[] = is_array($r) ? ['valor' => $valor, 'rotulo' => $r[0], 'lado' => $r[1]]
                                : ['valor' => $valor, 'rotulo' => $r];
    }
    return $saida;
}

/*
 * O que a tela precisa saber para nao repetir regra. Precisa de sessao,
 * mas nao de senha trocada: a tela de troca usa senha_min e regra_senha.
 */
function configuracao(array $usuario): array
{
    $admin = $usuario['perfil'] === 'admin';
    $dominios = [];
    foreach (array_keys(DOMINIOS) as $nome) {
        $dominios[$nome] = dominioParaTela($nome);
    }
    return [
        'senha_min'                => SENHA_MIN,
        'regra_senha'              => REGRA_SENHA,
        'parcelas_max'             => PARCELAS_MAX,
        'valor_maximo'             => VALOR_MAXIMO,
        'quantidade_maxima'        => QUANTIDADE_MAXIMA,
        'estoque_baixo'            => ESTOQUE_BAIXO,
        'garantia_padrao'          => GARANTIA_PADRAO,
        'garantia_maxima'          => GARANTIA_MAXIMA,
        'tempo_medio_maximo'       => TEMPO_MEDIO_MAXIMO,
        'janela_vencimentos'       => JANELA_VENCIMENTOS,
        'tolerancia_centavo'       => TOLERANCIA_CENTAVO,
        'status_os_em_andamento'   => STATUS_OS_EM_ANDAMENTO,
        'status_os_itens_travados' => STATUS_OS_ITENS_TRAVADOS,
        'dominios'                 => $dominios,
        'perfil'                   => $usuario['perfil'],
        'pode_excluir'             => $admin,
        'pode_ver_financeiro'      => $admin,
        'pode_admin'               => $admin,
        // As regras que valem agora (empresa > geral > fabrica). A tela so le:
        // quem aplica e a rota que a regra protege.
        'chaves'                   => chavesEfetivas(),
        'empresa'                  => (empresaAtual()['nome'] ?? ''),
    ];
}

// ------------------------------------------------------------------
// Usuarios (so admin)
// ------------------------------------------------------------------
function usuarios(?int $id, string $metodo, array $corpo, array $usuario, ?string $acao = null): array
{
    if ($usuario['perfil'] !== 'admin') {
        throw new ErroApi(403, 'Somente administradores podem gerenciar usuários.');
    }

    // POST /api/usuarios/{id}/destravar: apaga as tentativas erradas do login.
    if ($acao !== null) {
        if ($acao !== 'destravar') {
            throw new ErroApi(404, 'Rota não encontrada.');
        }
        exigir($metodo === 'POST');
        $alvo = consultarUm('SELECT usuario FROM usuarios WHERE id = ?', [exigirId($id)]);
        if (!$alvo) {
            throw new ErroApi(404, 'Usuário não encontrado.');
        }
        executarSql('DELETE FROM login_tentativas WHERE usuario = ?', [$alvo['usuario']]);
        return [200, ['ok' => true, 'mensagem' => 'Login de "' . $alvo['usuario'] . '" destravado.']];
    }

    if ($metodo === 'GET') {
        $sql = 'SELECT u.id, u.usuario, u.nome, u.perfil, u.ativo, u.ultimo_acesso, u.criado_em, u.trocar_senha FROM usuarios u';
        $comBloqueio = function (array $u): array {
            $u['bloqueado_ate'] = bloqueadoAte((string) $u['usuario']);
            $u['trocar_senha']  = (int) $u['trocar_senha'] === 1;
            return $u;
        };
        if ($id) {
            $item = consultarUm($sql . ' WHERE u.id = ?', [$id]);
            if (!$item) {
                throw new ErroApi(404, 'Usuário não encontrado.');
            }
            return [200, ['ok' => true, 'item' => $comBloqueio($item)]];
        }
        return [200, ['ok' => true, 'itens' => array_map($comBloqueio, consultar($sql . ' ORDER BY u.usuario'))]];
    }

    if ($metodo === 'POST') {
        $acesso = mb_strtolower(obrigatorio($corpo, 'usuario'));
        $nome   = obrigatorio($corpo, 'nome');
        $perfil = txt($corpo, 'perfil') ?? 'tecnico';
        if (!in_array($perfil, valoresDe('perfis'), true)) {
            throw new ErroApi(400, 'Perfil inválido: ' . $perfil . '. Use admin, tecnico ou balcao.');
        }
        if (consultarUm('SELECT id FROM usuarios WHERE usuario = ?', [$acesso])) {
            throw new ErroApi(400, 'Já existe um usuário com esse login.');
        }
        $senha = is_string($corpo['senha'] ?? null) ? $corpo['senha'] : '';
        $fraca = senhaFraca($senha, $acesso);
        if ($fraca !== null) {
            throw new ErroApi(400, $fraca);
        }
        // A senha que o admin escolheu e provisoria: a pessoa troca no 1o acesso.
        executarSql(
            'INSERT INTO usuarios (usuario, nome, senha_hash, perfil, ativo, trocar_senha) VALUES (?, ?, ?, ?, ?, 1)',
            [$acesso, $nome, gerarHash($senha), $perfil, ($corpo['ativo'] ?? 1) ? 1 : 0]
        );
        return [201, ['ok' => true, 'id' => (int) banco()->lastInsertId(),
                      'mensagem' => 'Usuário criado. No primeiro acesso ele vai trocar a senha.']];
    }

    if ($metodo === 'PUT') {
        $id = exigirId($id);
        return emTransacao(function () use ($id, $corpo, $usuario) {
            $alvo = consultarUm('SELECT * FROM usuarios WHERE id = ?', [$id]);
            if (!$alvo) {
                throw new ErroApi(404, 'Usuário não encontrado.');
            }
            $perfil = txt($corpo, 'perfil') ?? $alvo['perfil'];
            if (!in_array($perfil, valoresDe('perfis'), true)) {
                throw new ErroApi(400, 'Perfil inválido: ' . $perfil . '. Use admin, tecnico ou balcao.');
            }
            $ativo = !array_key_exists('ativo', $corpo) ? (int) $alvo['ativo'] : ($corpo['ativo'] ? 1 : 0);
            if ($id === (int) $usuario['id'] && $ativo === 0) {
                throw new ErroApi(400, 'Você não pode desativar o próprio usuário.');
            }
            if ($alvo['perfil'] === 'admin' && (int) $alvo['ativo'] === 1 && ($perfil !== 'admin' || $ativo === 0)) {
                conferirOutroAdmin($id);
            }
            executarSql('UPDATE usuarios SET nome = ?, perfil = ?, ativo = ? WHERE id = ?',
                [txt($corpo, 'nome') ?? $alvo['nome'], $perfil, $ativo, $id]);
            if (txt($corpo, 'senha') !== null) {
                $senha = (string) $corpo['senha'];
                $fraca = senhaFraca($senha, (string) $alvo['usuario']);
                if ($fraca !== null) {
                    throw new ErroApi(400, $fraca);
                }
                // Senha redefinida pelo admin: provisoria (a do proprio admin, nao).
                executarSql('UPDATE usuarios SET senha_hash = ?, trocar_senha = ? WHERE id = ?',
                    [gerarHash($senha), $id === (int) $usuario['id'] ? 0 : 1, $id]);
                limparTentativas((string) $alvo['usuario']);
            }
            return [200, ['ok' => true, 'mensagem' => 'Usuário atualizado.']];
        });
    }

    if ($metodo === 'DELETE') {
        $id = exigirId($id);
        if ($id === (int) $usuario['id']) {
            throw new ErroApi(400, 'Você não pode excluir o próprio usuário.');
        }
        $alvo = consultarUm('SELECT * FROM usuarios WHERE id = ?', [$id]);
        if (!$alvo) {
            throw new ErroApi(404, 'Usuário não encontrado.');
        }
        if ($alvo['perfil'] === 'admin' && (int) $alvo['ativo'] === 1) {
            conferirOutroAdmin($id);
        }
        // Quem ja aparece no historico nao se exclui: desativar resolve.
        $rastros = (int) consultarUm(
            'SELECT (SELECT COUNT(*) FROM vendas WHERE usuario_id = ?) +
                    (SELECT COUNT(*) FROM ordens_servico WHERE tecnico_id = ?) +
                    (SELECT COUNT(*) FROM os_historico WHERE usuario_id = ?) +
                    (SELECT COUNT(*) FROM lancamentos WHERE usuario_id = ?) +
                    (SELECT COUNT(*) FROM lancamentos_log WHERE usuario_id = ?) +
                    (SELECT COUNT(*) FROM movimentacoes WHERE usuario_id = ?) AS q',
            [$id, $id, $id, $id, $id, $id]
        )['q'];
        if ($rastros > 0) {
            throw new ErroApi(400, "Este usuário aparece em {$rastros} registro(s) do histórico e não pode ser "
                . 'excluído. Desative-o: ele não entra mais e o histórico continua com o nome.');
        }
        executarSql('DELETE FROM usuarios WHERE id = ?', [$id]);
        return [200, ['ok' => true, 'mensagem' => 'Usuário excluído.']];
    }

    throw new ErroApi(405, 'Método não permitido para /api/usuarios.');
}

/* Sem pelo menos um admin ativo, ninguem mais gerencia usuarios. */
function conferirOutroAdmin(int $saindo): void
{
    $outros = (int) consultarUm(
        "SELECT COUNT(*) AS q FROM usuarios WHERE perfil = 'admin' AND ativo = 1 AND id <> ?", [$saindo])['q'];
    if ($outros === 0) {
        throw new ErroApi(400, 'Este é o último administrador ativo. Promova outro usuário a admin antes.');
    }
}
