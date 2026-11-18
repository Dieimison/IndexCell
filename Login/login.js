// carga: usa Formato; publica (nada)  (conferido por testes/front/carga.test.js)
/*
 * login.js - tela de login do sistema Index Celulares
 *
 * O usuario e a senha sao conferidos no banco (dados/index.sqlite),
 * pela rota POST /api/login. Nada de senha escrita dentro do JavaScript:
 * o navegador so recebe "entrou" ou "nao entrou".
 *
 * Duas portas na mesma tela (v8):
 *   Funcionario  usuario + senha -> POST /api/login      -> painel
 *   Cliente      e-mail + senha  -> POST /api/loja/entrar -> loja online
 *                (Minhas encomendas). Sessoes separadas: a conta do
 *                cliente nunca abre o painel.
 * /Login/index.html#cliente ja abre na aba do cliente.
 *
 * Isto exige o servidor rodando (iniciar-servidor.bat). Abrindo o
 * index.html direto pelo arquivo (file://) nao existe servidor para
 * responder, e a tela avisa isso.
 */
document.addEventListener('DOMContentLoaded', function () {
    // O mesmo escapador do painel (Dashboard/formato.js, carregado antes).
    const escapar = window.Formato.escapar;

    const loginForm = document.getElementById('loginForm');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMsg = document.getElementById('errorMessage');
    const botao = loginForm.querySelector('button');

    /* O que muda de uma porta para a outra. */
    const MODOS = {
        funcionario: { titulo: 'Assistência Técnica', rotulo: 'USUÁRIO', tipo: 'text', icone: '👤', autocomplete: 'username',
                       exemplo: 'Digite seu código de técnico', botao: 'Acessar Sistema', guardado: 'techUsername',
                       vazio: 'Preencha usuário e senha.', invalido: 'Credenciais inválidas. Verifique seu usuário e senha.' },
        cliente: { titulo: 'Área do cliente', rotulo: 'E-MAIL', tipo: 'email', icone: '✉', autocomplete: 'email',
                   exemplo: 'seu@email.com', botao: 'Entrar na minha conta', guardado: 'lojaEmail',
                   vazio: 'Preencha e-mail e senha.', invalido: 'E-mail ou senha incorretos.' },
    };
    let modo = 'funcionario';
    let textoOriginal = botao.innerHTML;

    function lerGuardado(chave) {
        try { return localStorage.getItem(chave); } catch (erro) { return null; }   // navegador sem memoria
    }
    function guardar(chave, valor) {
        try { localStorage.setItem(chave, valor); } catch (erro) { /* so nao preenche da proxima vez */ }
    }

    function aplicarModo(novo, focar) {
        modo = novo;
        const m = MODOS[modo];
        document.querySelectorAll('.aba-login').forEach(function (aba) {
            const ativa = aba.dataset.modo === modo;
            aba.classList.toggle('ativa', ativa);
            aba.setAttribute('aria-selected', String(ativa));
        });
        document.getElementById('tituloLogin').textContent = m.titulo;
        document.getElementById('rotuloUsuario').textContent = m.rotulo;
        document.getElementById('iconeUsuario').textContent = m.icone;
        document.getElementById('clienteLinks').hidden = modo !== 'cliente';
        usernameInput.type = m.tipo;
        usernameInput.placeholder = m.exemplo;
        usernameInput.autocomplete = m.autocomplete;
        botao.textContent = m.botao;
        textoOriginal = botao.innerHTML;
        errorMsg.style.display = 'none';
        passwordInput.value = '';

        const salvo = lerGuardado(m.guardado);
        usernameInput.value = salvo || '';
        usernameInput.parentElement.classList.toggle('focused', !!salvo);
        if (focar !== false) (salvo ? passwordInput : usernameInput).focus();
        guardar('loginModo', modo);
    }

    document.querySelectorAll('.aba-login').forEach(function (aba) {
        aba.addEventListener('click', function () { aplicarModo(aba.dataset.modo); });
    });

    // Efeito de foco nos campos
    document.querySelectorAll('input').forEach(function (input) {
        input.addEventListener('focus', function () {
            this.parentElement.classList.add('focused');
        });
        input.addEventListener('blur', function () {
            if (this.value === '') {
                this.parentElement.classList.remove('focused');
            }
        });
    });

    loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const m = MODOS[modo];
        const usuario = usernameInput.value.trim();
        const senha = passwordInput.value;

        if (!usuario || !senha) {
            mostrarErro(m.vazio);
            return;
        }

        botao.innerHTML = '<span class="spinner"></span> VERIFICANDO...';
        botao.disabled = true;
        errorMsg.style.display = 'none';

        const cliente = modo === 'cliente';
        try {
            const resposta = await fetch(cliente ? '/api/loja/entrar' : '/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(cliente ? { email: usuario, senha: senha } : { usuario: usuario, senha: senha }),
            });
            const dados = await resposta.json().catch(function () { return {}; });

            if (resposta.ok && dados.ok) {
                // Guarda so o login (nunca a senha), para preencher da proxima vez
                guardar(m.guardado, usuario);
                botao.innerHTML = '<span class="success">✓</span> ACESSO AUTORIZADO';
                botao.classList.add('success-button');
                if (cliente) {
                    mostrarSucesso(dados.conta.nome, 'Abrindo as suas encomendas na loja online...');
                    setTimeout(function () { window.location.href = '../Loja/index.html#/encomendas'; }, 900);
                    return;
                }
                // Senha provisoria: o painel abre direto na troca obrigatoria.
                mostrarSucesso(dados.usuario.nome, dados.usuario.trocar_senha ? 'Antes de começar, troque a sua senha provisória.'
                                                                              : 'Abrindo o painel de controle...');
                setTimeout(function () {
                    window.location.href = '../Dashboard/dashboard.html';
                }, 900);
                return;
            }

            /* 429: muitas tentativas erradas, o servidor segura o login por
               alguns minutos e diz quantos. A mensagem e a dele. */
            if (resposta.status === 429) {
                mostrarErro(dados.erro || 'Muitas tentativas. Espere alguns minutos e tente de novo.');
            } else {
                /* 401 traz "restam": quantas tentativas faltam para o bloqueio.
                   Avisar antes evita trancar o login de surpresa. Se o texto do
                   servidor ja diz quantas restam, ele vale sozinho. */
                const texto = dados.erro || m.invalido;
                const restam = dados.restam === null || dados.restam === undefined || /Restam/.test(texto) ? ''
                    : ' Restam ' + dados.restam + ' tentativa(s) antes de o login ser bloqueado.';
                mostrarErro(texto + restam);
            }
        } catch (erro) {
            // Cai aqui quando o servidor nao esta no ar (ou a pagina foi
            // aberta direto pelo arquivo, sem servidor nenhum).
            mostrarErro('Não foi possível falar com o servidor. Inicie o sistema pelo iniciar-servidor.bat.');
        }

        botao.innerHTML = textoOriginal;
        botao.disabled = false;
        botao.classList.remove('success-button');
    });

    function mostrarErro(mensagem) {
        errorMsg.textContent = mensagem;
        errorMsg.style.display = 'block';
        botao.innerHTML = textoOriginal;
        botao.disabled = false;

        loginForm.classList.add('shake');
        setTimeout(function () {
            loginForm.classList.remove('shake');
        }, 500);
        passwordInput.select();
    }

    function mostrarSucesso(nome, texto) {
        const overlay = document.createElement('div');
        overlay.className = 'success-overlay';
        overlay.innerHTML =
            '<div class="success-modal">' +
            '    <div class="success-icon">✓</div>' +
            '    <h3>Bem-vindo, ' + escapar(nome) + '!</h3>' +
            '    <p>' + escapar(texto) + '</p>' +
            '</div>';
        document.body.appendChild(overlay);
        setTimeout(function () {
            overlay.classList.add('visible');
        }, 50);
    }

    // Aba inicial: #cliente no endereco, senao a ultima usada neste navegador.
    const pedido = /^#cliente$/i.test(location.hash) ? 'cliente' : lerGuardado('loginModo');
    aplicarModo(pedido === 'cliente' ? 'cliente' : 'funcionario');

    // Funcionario com sessao aberta? Vai direto para o painel.
    if (modo === 'funcionario') {
        fetch('/api/sessao', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (dados) {
                if (dados && dados.ok && modo === 'funcionario') {
                    window.location.href = '../Dashboard/dashboard.html';
                }
            })
            .catch(function () { /* sem servidor: fica na tela de login mesmo */ });
    }
});
