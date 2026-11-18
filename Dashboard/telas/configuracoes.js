// carga: usa Formato, Nucleo, Janela; publica Telas.configuracoes  (conferido por testes/front/carga.test.js)
/*
 * telas/configuracoes.js - Minha conta (trocar a propria senha) e, para o
 * admin, os usuarios do sistema. Window.Telas.configuracoes.
 *
 * A regra de senha e do servidor: o texto dela (config.regra_senha) aparece
 * nos tres lugares onde se escolhe senha, e a recusa vem como 400 com a
 * mensagem do servidor, mostrada ao lado do campo.
 */
(function (janela) {
    'use strict';

    const { escapar, dataCurta, horaCurta, hoje } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, vazio, tabelaHtml, etiquetaTexto } = N;
    const { abrirModal } = janela.Janela;

    const rotuloPerfil = function (p) { return N.rotuloDe('perfis', p); };

    /* "Bloqueado até 14:37" (ou "até 28/10 14:37" se nao for hoje). */
    function textoBloqueio(ate) {
        const dia = String(ate).substring(0, 10);
        return 'Bloqueado até ' + (dia === hoje() ? '' : dataCurta(ate).substring(0, 5) + ' ') + horaCurta(ate);
    }

    async function carregarConfiguracoes() {
        const usuario = estado.usuario;
        document.getElementById('dadosConta').innerHTML =
            '<div><span>Nome</span><strong>' + escapar(usuario.nome) + '</strong></div>' +
            '<div><span>Usuário</span><strong>' + escapar(usuario.usuario) + '</strong></div>' +
            '<div><span>Perfil</span><strong>' + escapar(rotuloPerfil(usuario.perfil)) + '</strong></div>';

        const bloco = document.getElementById('blocoUsuarios');
        if (usuario.perfil !== 'admin') {
            bloco.classList.add('oculta');
            return;
        }
        bloco.classList.remove('oculta');

        estado.usuarios = (await api.get('/usuarios')).itens;
        document.getElementById('listaUsuarios').innerHTML = estado.usuarios.length
            ? tabelaHtml({
                rolagem: false,
                colunas: ['Usuário', 'Nome', 'Perfil', 'Ativo', { titulo: 'Ações', classe: 'coluna-acoes' }],
                linhas: estado.usuarios.map(function (u) {
                    return [
                        escapar(u.usuario) +
                            (u.bloqueado_ate ? '<br>' + etiquetaTexto(textoBloqueio(u.bloqueado_ate), '--critico') : '') +
                            (u.trocar_senha ? '<br><small class="observacao">troca a senha no próximo acesso</small>' : ''),
                        escapar(u.nome),
                        escapar(rotuloPerfil(u.perfil)),
                        u.ativo ? 'Sim' : 'Não',
                        { classe: 'coluna-acoes', html:
                            (u.bloqueado_ate
                                ? '<button type="button" class="botao-icone" data-acao="destravar-usuario" data-id="' + u.id +
                                  '" title="Libera o login agora, sem esperar o bloqueio acabar">Destravar</button> ' : '') +
                            '<button type="button" class="botao-icone" data-acao="editar-usuario" data-id="' + u.id + '">Editar</button> ' +
                            (u.id === estado.usuario.id ? ''
                                : '<button type="button" class="botao-icone perigo" data-acao="excluir-usuario" data-id="' + u.id + '">Excluir</button>') },
                    ];
                }),
            })
            : vazio('Nenhum usuário cadastrado.');
    }

    /*
     * Usuario. A senha que o admin escolhe aqui e provisoria: no primeiro
     * acesso a pessoa e obrigada a trocar (o servidor marca trocar_senha).
     */
    function formularioUsuario(usuario) {
        usuario = usuario || {};
        const novo = !usuario.id;
        return [
            { nome: 'usuario', rotulo: 'Usuário (login)', valor: usuario.usuario, obrigatorio: novo, desabilitado: !novo },
            { nome: 'nome', rotulo: 'Nome completo', valor: usuario.nome, obrigatorio: true },
            { nome: 'perfil', rotulo: 'Perfil', tipo: 'select', valor: usuario.perfil || 'tecnico',
              opcoes: N.opcoesDoDominio('perfis') },
            {
                nome: 'ativo', rotulo: 'Ativo', tipo: 'select',
                valor: usuario.ativo === undefined ? '1' : String(usuario.ativo),
                opcoes: [{ valor: '1', rotulo: 'Sim' }, { valor: '0', rotulo: 'Não' }],
            },
            {
                nome: 'senha', rotulo: novo ? 'Senha provisória' : 'Nova senha provisória', tipo: 'password',
                obrigatorio: novo, minimo: estado.config.senha_min, autocomplete: 'new-password',
                dica: (novo ? '' : 'Deixe em branco para não trocar. ') + estado.config.regra_senha +
                      ' A pessoa troca esta senha no primeiro acesso.',
                largura: 'total',
            },
        ];
    }

    // Trocar a propria senha. A recusa do servidor fica escrita no formulario.
    document.getElementById('formSenha').addEventListener('submit', async function (evento) {
        evento.preventDefault();
        const atual = document.getElementById('senhaAtual');
        const nova = document.getElementById('senhaNova');
        const confirma = document.getElementById('senhaConfirma');
        const erro = document.getElementById('senhaErro');
        erro.textContent = '';

        if (nova.value !== confirma.value) {
            erro.textContent = 'A confirmação não bate com a nova senha.';
            return;
        }
        try {
            const resposta = await api.post('/trocar-senha', { senha_atual: atual.value, senha_nova: nova.value });
            avisar(mensagemDe(resposta, 'Senha alterada com sucesso.'));
            this.reset();
        } catch (falha) {
            erro.textContent = falha.message;
        }
    });

    N.registrarAcoes({
        'novo-usuario': function () {
            return abrirModal({
                titulo: 'Novo usuário',
                campos: formularioUsuario(null),
                aoSalvar: async function (valores) {
                    valores.ativo = Number(valores.ativo);
                    avisar(mensagemDe(await api.post('/usuarios', valores), 'Usuário criado.'));
                    await carregarConfiguracoes();
                },
            });
        },
        'editar-usuario': function (id) {
            const usuario = estado.usuarios.find(function (u) { return u.id === id; });
            return abrirModal({
                titulo: 'Editar ' + usuario.usuario,
                campos: formularioUsuario(usuario),
                aoSalvar: async function (valores) {
                    valores.ativo = Number(valores.ativo);
                    delete valores.usuario; // o login nao muda
                    if (!valores.senha) delete valores.senha;
                    avisar(mensagemDe(await api.put('/usuarios/' + id, valores), 'Usuário atualizado.'));
                    await carregarConfiguracoes();
                },
            });
        },
        'excluir-usuario': async function (id) {
            const usuario = estado.usuarios.find(function (u) { return u.id === id; });
            if (!confirm('Excluir o usuário "' + usuario.usuario + '"?')) return;
            avisar(mensagemDe(await api.remover('/usuarios/' + id), 'Usuário excluído.'));
            await carregarConfiguracoes();
        },
        'destravar-usuario': async function (id) {
            const usuario = estado.usuarios.find(function (u) { return u.id === id; });
            avisar(mensagemDe(await api.post('/usuarios/' + id + '/destravar', {}),
                              'Login de ' + usuario.usuario + ' liberado.'));
            await carregarConfiguracoes();
        },
    });

    N.registrarTela('configuracoes', { titulo: 'Minha conta', carregar: carregarConfiguracoes });
    janela.Telas = janela.Telas || {};
    janela.Telas.configuracoes = {};
})(window);
