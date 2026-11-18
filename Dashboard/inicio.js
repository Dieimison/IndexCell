// carga: usa Nucleo, Telas.painel, Telas.movimentacao, Telas.entradas, Telas.os, Telas.vendas, Telas.cadastros, Telas.financeiro, Telas.configuracoes, Telas.inicio, Telas.pdv, Telas.admin, Telas.fiscal, Telas.pedidos; publica (nada)  (conferido por testes/front/carga.test.js)
/*
 * inicio.js - abre o painel: sessao, /api/config, perfil, troca obrigatoria
 * de senha e a primeira secao. Ultimo script do dashboard.html.
 *
 * Nada e desenhado antes de o /api/config chegar: limites, dominios e o que
 * o perfil pode vem de la, e a tela nao tem numeros de reserva. Se ele nao
 * vier, aparece um aviso com "Tentar de novo".
 */
(function (janela) {
    'use strict';

    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, ganchosApi, mostrarSecao } = N;

    /* As chaves que a tela usa. Faltando alguma, o painel nao abre pela
       metade: avisa qual falta (servidor desatualizado). */
    const CHAVES_DA_CONFIG = ['senha_min', 'regra_senha', 'parcelas_max', 'valor_maximo', 'quantidade_maxima',
        'estoque_baixo', 'garantia_padrao', 'garantia_maxima', 'janela_vencimentos', 'tempo_medio_maximo',
        'tolerancia_centavo', 'status_os_em_andamento', 'status_os_itens_travados', 'dominios',
        'perfil', 'pode_excluir', 'pode_ver_financeiro', 'pode_admin', 'chaves'];

    async function carregarConfig() {
        const config = (await api.get('/config')).config || {};
        const faltam = CHAVES_DA_CONFIG.filter(function (k) { return config[k] === undefined || config[k] === null; });
        if (faltam.length) {
            throw new Error('O servidor não mandou a configuração completa (faltam: ' + faltam.join(', ') +
                            '). Atualize o sistema no servidor.');
        }
        estado.config = config;
    }

    /* Tenta ate conseguir; cada falha mostra o aviso com o botao. */
    function carregarConfigComAviso() {
        return carregarConfig().catch(function (erro) {
            return new Promise(function (resolver) {
                const aviso = document.createElement('div');
                aviso.className = 'falha-config';
                aviso.setAttribute('role', 'alert');
                aviso.innerHTML = '<div><strong>Não foi possível carregar a configuração do sistema.</strong>' +
                                  '<p></p><button type="button" class="botao">Tentar de novo</button></div>';
                aviso.querySelector('p').textContent = erro.message;
                aviso.querySelector('button').addEventListener('click', function () {
                    aviso.remove();
                    resolver(carregarConfigComAviso());
                });
                document.body.appendChild(aviso);
            });
        });
    }

    /*
     * Perfil tecnico e balcao (pode_ver_financeiro e pode_excluir falsos):
     * somem o Financeiro, os relatorios do painel e os botoes Excluir. O
     * servidor recusa do mesmo jeito; isto e para a tela nao oferecer o
     * que vai ser recusado.
     */
    function aplicarPerfil() {
        const c = estado.config;
        document.body.classList.toggle('sem-financeiro', !c.pode_ver_financeiro);
        document.body.classList.toggle('sem-exclusao', !c.pode_excluir);
        document.body.classList.toggle('sem-admin', !c.pode_admin);
        ['senhaNova', 'senhaConfirma'].forEach(function (id) { document.getElementById(id).minLength = c.senha_min; });
        document.getElementById('regraSenhaConta').textContent = c.regra_senha;
    }

    // ------------------------------------------------------------------
    // Troca obrigatoria de senha
    // ------------------------------------------------------------------
    /*
     * Usuario com senha provisoria (criado pelo admin, ou com a senha
     * redefinida) nao usa o sistema antes de trocar: o servidor responde
     * 403 com "trocar_senha" a tudo, menos login, sessao, config e a troca.
     * A janela abre na frente de tudo e NAO fecha por Esc, clique fora ou x
     * (nao tem x): a unica outra saida e Sair.
     */
    const esperandoTroca = [];

    function abrirTrocaObrigatoria() {
        const tela = document.getElementById('trocaSenha');
        if (tela.classList.contains('oculta')) {
            document.getElementById('formTrocaSenha').reset();
            document.getElementById('trocaSenhaErro').textContent = '';
            document.getElementById('trocaSenhaDica').textContent =
                (estado.config ? estado.config.regra_senha + ' ' : '') + 'Não use a senha que recebeu.';
            if (estado.config) {
                ['trocaNova', 'trocaConfirma'].forEach(function (id) {
                    document.getElementById(id).minLength = estado.config.senha_min;
                });
            }
            tela.classList.remove('oculta');
            document.getElementById('trocaAtual').focus();
        }
        return new Promise(function (resolver) { esperandoTroca.push(resolver); });
    }

    ganchosApi.trocarSenha = abrirTrocaObrigatoria;

    document.getElementById('formTrocaSenha').addEventListener('submit', async function (evento) {
        evento.preventDefault();
        const erro = document.getElementById('trocaSenhaErro');
        const atual = document.getElementById('trocaAtual').value;
        const nova = document.getElementById('trocaNova').value;
        const confirma = document.getElementById('trocaConfirma').value;
        const botao = this.querySelector('button[type="submit"]');

        erro.textContent = '';
        if (nova !== confirma) {
            erro.textContent = 'A confirmação não bate com a nova senha.';
            return;
        }
        botao.disabled = true;
        try {
            const resposta = await api.post('/trocar-senha', { senha_atual: atual, senha_nova: nova });
            if (estado.usuario) estado.usuario.trocar_senha = false;
            document.getElementById('trocaSenha').classList.add('oculta');
            avisar(mensagemDe(resposta, 'Senha alterada com sucesso.'));
            esperandoTroca.splice(0).forEach(function (resolver) { resolver(); });
        } catch (falha) {
            // A recusa do servidor (regra de senha, senha atual errada) aparece aqui.
            erro.textContent = falha.message;
        } finally {
            botao.disabled = false;
        }
    });

    document.getElementById('trocaSair').addEventListener('click', function () {
        document.getElementById('botaoSair').click();
    });

    document.getElementById('botaoSair').addEventListener('click', async function () {
        try {
            await api.post('/logout', {});
        } catch (erro) {
            // mesmo se der erro, tira o usuario da tela
        }
        window.location.href = '../Login/index.html';
    });

    /* O canto do usuario (nome, perfil, inicial). */
    function mostrarUsuario(usuario) {
        document.getElementById('usuarioNome').textContent = usuario.nome;
        document.getElementById('usuarioPerfil').textContent = N.rotuloDe('perfis', usuario.perfil);
        document.getElementById('usuarioInicial').textContent = (usuario.nome || '?').trim().charAt(0).toUpperCase();
    }

    /* Login feito de novo dentro da janela (sessao caida): o canto e o perfil
       acompanham. A janela so aceita o MESMO usuario; outro recarrega o painel. */
    ganchosApi.usuarioAtualizado = function (usuario) {
        mostrarUsuario(usuario);
        if (estado.config) aplicarPerfil();
    };

    // ------------------------------------------------------------------
    // Inicio
    // ------------------------------------------------------------------
    (async function iniciar() {
        try {
            estado.usuario = (await api.get('/sessao')).usuario;
        } catch (erro) {
            window.location.href = '../Login/index.html';
            return;
        }

        mostrarUsuario(estado.usuario);
        document.getElementById('currentDate').textContent = new Date().toLocaleDateString('pt-BR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });

        await carregarConfigComAviso();
        aplicarPerfil();
        mostrarUsuario(estado.usuario);   // agora com o rotulo do perfil (config.dominios)

        // Senha provisoria: troca antes de qualquer outra coisa.
        if (estado.usuario.trocar_senha) await abrirTrocaObrigatoria();

        // Depois do login a pessoa cai no Inicio (os modulos); um link com #secao abre a secao.
        mostrarSecao((window.location.hash || '#inicio').replace('#', ''));
    })();
})(window);
