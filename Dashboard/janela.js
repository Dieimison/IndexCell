// carga: usa Formato, Nucleo; publica Janela  (conferido por testes/front/carga.test.js)
/*
 * janela.js - a janela de cadastro/edicao (o modal). Window.Janela.
 *
 *   abrirModal({ titulo, campos | html, aoSalvar(valores), aoAbrir(),
 *                textoSalvar, somenteLeitura, recarregar() })
 *
 * O formulario e montado de uma lista de campos (campoHtml). Ao salvar,
 * valoresDoModal() le os campos e cada editor (itens, pagamentos) junta o
 * seu pedaco pelo gancho "coletar". Se aoSalvar lancar erro, a janela
 * NAO fecha: a mensagem aparece dentro dela e o que foi digitado fica.
 *
 * Tres jeitos de nao perder o formulario:
 *   - Esc e clique fora so fazem a janela tremer (recusarFechamento);
 *   - F5/fechar a aba com algo digitado: o navegador pergunta (beforeunload);
 *   - sessao caida no meio: o login e feito AQUI MESMO, num formulario
 *     pequeno dentro do aviso, e depois o Salvar funciona.
 *
 * Antes de gravar, a janela confere que a sessao ainda e do MESMO usuario
 * que abriu o painel (alguem pode ter entrado com outro login noutra aba):
 * se nao for, nada e gravado e o painel recarrega com o usuario novo.
 *
 * A janela nao conhece os editores: quem desenha os campos "itens" e
 * "pagamentos" se registra aqui (registrarTipoDeCampo), e quem coleta e
 * confere o que eles tem, pelos ganchos.
 */
(function (janela) {
    'use strict';

    const { escapar } = janela.Formato;
    const { api, estado, ganchosApi, avisar } = janela.Nucleo;

    const modal = document.getElementById('modal');
    const modalForm = document.getElementById('modalForm');
    const modalCorpo = document.getElementById('modalCorpo');

    let aoSalvarModal = null;
    let configModal = null;     // o config do abrirModal em uso
    let modalAlterado = false;  // alguem digitou ou escolheu algo desde que abriu
    let alterados = new Set();  // os campos em que a pessoa mexeu (para "Copiar o que digitei")
    let saindo = false;         // recarga pedida pela propria janela: sem pergunta do navegador

    /* Ganchos dos editores (editores.js): montar ao abrir, coletar ao
       salvar e conferir de novo depois de uma falha. */
    const ganchos = { montar: [], coletar: [], depoisDeFalhar: [] };

    /* Tipos de campo desenhados por outro arquivo: tipo -> function (campo) -> html. */
    const tiposDeCampo = {};

    function registrarTipoDeCampo(tipo, desenhar) {
        tiposDeCampo[tipo] = desenhar;
    }

    function abrirModal(config) {
        document.getElementById('modalTitulo').textContent = config.titulo;
        modalCorpo.innerHTML = config.html || config.campos.map(campoHtml).join('');
        aoSalvarModal = config.aoSalvar || null;
        configModal = config;
        modalAlterado = false;
        alterados = new Set();
        limparErroDoModal();

        modalForm.querySelector('.modal-rodape').classList.toggle('oculta', !!config.somenteLeitura);
        document.getElementById('modalSalvar').textContent = config.textoSalvar || 'Salvar';

        // So a janela de leitura fecha com clique fora ou Esc.
        modal.dataset.somenteLeitura = config.somenteLeitura ? '1' : '0';

        modal.classList.remove('oculta');
        ligarSelectNovo();
        ligarInterruptores();
        ganchos.montar.forEach(function (f) { f(); });
        if (config.aoAbrir) config.aoAbrir();

        const primeiro = modalCorpo.querySelector('input:not([disabled]):not([type=hidden]), select, textarea');
        if (primeiro) primeiro.focus();
    }

    function fecharModal() {
        modal.classList.add('oculta');
        modalCorpo.innerHTML = '';
        aoSalvarModal = null;
        configModal = null;
        modalAlterado = false;
        alterados = new Set();
        limparErroDoModal();
    }

    function aberta() {
        return !modal.classList.contains('oculta');
    }

    /** Ha um formulario de cadastro aberto (nao a janela so de leitura)? */
    function formularioAberto() {
        return aberta() && modal.dataset.somenteLeitura !== '1';
    }

    function formularioAlterado() {
        return modalAlterado;
    }

    function configAtual() {
        return configModal;
    }

    ganchosApi.formularioAberto = formularioAberto;

    /* Voltar do navegador (nucleo.js): com formulario alterado, nao troca de
       secao - a janela treme; sem alteracao, fecha e deixa navegar. */
    ganchosApi.antesDeNavegar = function () {
        if (formularioAberto() && modalAlterado) {
            recusarFechamento();
            return false;
        }
        if (aberta()) fecharModal();
        return true;
    };

    /* So o que a PESSOA faz marca o formulario como alterado: as contas que
       a tela escreve sozinha nos campos nao disparam input/change. */
    function marcarAlterado(evento) {
        modalAlterado = true;
        alterados.add(evento.target);
    }
    modalCorpo.addEventListener('input', marcarAlterado);
    modalCorpo.addEventListener('change', marcarAlterado);

    /* F5, fechar a aba ou sair com um formulario alterado: o navegador pergunta. */
    window.addEventListener('beforeunload', function (evento) {
        if (!saindo && formularioAberto() && modalAlterado) {
            evento.preventDefault();
            evento.returnValue = '';
        }
    });

    // ------------------------------------------------------------------
    // Erro dentro da janela
    // ------------------------------------------------------------------
    /*
     * A mensagem fica entre o formulario e os botoes e nao some sozinha.
     * Nao ha toast junto: repetido, ele cobria o botao Salvar.
     * "botoes" acrescenta acoes ao aviso ({ texto, acao }).
     */
    function mostrarErroNoModal(mensagem, botoes) {
        limparErroDoModal();
        const caixa = document.createElement('div');
        caixa.className = 'modal-erro';
        caixa.setAttribute('role', 'alert');
        const texto = document.createElement('div');
        texto.textContent = mensagem;
        caixa.appendChild(texto);
        if (botoes && botoes.length) {
            const linha = document.createElement('div');
            linha.className = 'modal-erro-acoes';
            botoes.forEach(function (b) {
                const botao = document.createElement('button');
                botao.type = 'button';
                botao.className = 'botao botao-secundario botao-pequeno';
                botao.textContent = b.texto;
                botao.addEventListener('click', b.acao);
                linha.appendChild(botao);
            });
            caixa.appendChild(linha);
        }
        modalForm.querySelector('.modal-rodape').before(caixa);
        return caixa;
    }

    function limparErroDoModal() {
        const caixa = modalForm.querySelector('.modal-erro');
        if (caixa) caixa.remove();
    }

    /*
     * Sessao caida (Sair em outra aba, sessao vencida): o login e feito
     * dentro do proprio aviso. Fora daqui o formulario fica intocado, e
     * depois de entrar basta clicar em Salvar de novo. Usa fetch direto:
     * o 401 de senha errada aqui e resposta do login, nao "sessao caida".
     */
    function pedirLoginNaJanela(mensagem) {
        const caixa = mostrarErroNoModal(mensagem);
        const login = document.createElement('div');
        login.className = 'login-na-janela';
        // O usuario vem travado: entrar aqui com outro login gravaria em nome errado.
        login.innerHTML =
            '<input type="text" data-login-usuario autocomplete="username" readonly title="O mesmo usuário que abriu o painel" value="' +
                escapar(estado.usuario ? estado.usuario.usuario : '') + '">' +
            '<input type="password" data-login-senha autocomplete="current-password" placeholder="Senha">' +
            '<button type="button" class="botao botao-pequeno" data-login-entrar>Entrar</button>' +
            '<div class="login-na-janela-erro" role="alert"></div>';
        caixa.appendChild(login);

        const usuario = login.querySelector('[data-login-usuario]');
        const senha = login.querySelector('[data-login-senha]');
        const erro = login.querySelector('.login-na-janela-erro');
        const entrar = login.querySelector('[data-login-entrar]');

        async function fazerLogin() {
            erro.textContent = '';
            entrar.disabled = true;
            try {
                const resposta = await fetch('/api/login', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: usuario.value.trim(), senha: senha.value }),
                });
                const dados = await resposta.json().catch(function () { return {}; });
                if (!resposta.ok || !dados.ok) {
                    const texto = dados.erro || 'Não foi possível entrar.';
                    erro.textContent = texto + (/Restam/.test(texto) ? '' : textoRestam(dados.restam));
                    senha.select();
                    return;
                }
                if (estado.usuario && dados.usuario.id !== estado.usuario.id) {
                    mostrarUsuarioTrocado(dados.usuario);
                    return;
                }
                estado.usuario = dados.usuario;
                ganchosApi.usuarioAtualizado(dados.usuario);
                caixa.className = 'modal-erro modal-ok';
                caixa.textContent = 'Você entrou de novo. Clique em Salvar para gravar o que está na janela.';
                if (dados.usuario.trocar_senha) ganchosApi.trocarSenha();
            } catch (falha) {
                erro.textContent = 'Sem conexão com o servidor.';
            } finally {
                entrar.disabled = false;
            }
        }

        entrar.addEventListener('click', fazerLogin);
        // Enter nos dois campos entra, em vez de enviar o formulario de fundo.
        [usuario, senha].forEach(function (campo) {
            campo.addEventListener('keydown', function (evento) {
                if (evento.key === 'Enter') { evento.preventDefault(); fazerLogin(); }
            });
        });
        (usuario.value ? senha : usuario).focus();
    }

    /*
     * A sessao agora e de OUTRA pessoa (entrou com outro login noutra aba).
     * Nada e gravado: o documento sairia em nome de quem nao o fez, com a
     * tela dizendo outro nome. O painel recarrega com o usuario da sessao;
     * antes, a pessoa pode copiar o que digitou.
     */
    function mostrarUsuarioTrocado(outro) {
        mostrarErroNoModal('Você entrou como ' + (outro.nome || outro.usuario) + '. Para não gravar em nome errado, ' +
                           'o painel vai recarregar com o seu usuário — copie o que digitou antes.', [
            { texto: 'Copiar o que digitei', acao: copiarDigitado },
            { texto: 'Recarregar', acao: function () { saindo = true; window.location.reload(); } },
        ]);
    }

    /* Antes de gravar: a sessao ainda e de quem abriu o painel? (401 aqui
       cai no login dentro da janela, como em qualquer gravacao.) */
    async function conferirMesmoUsuario() {
        const sessao = (await api.get('/sessao')).usuario;
        if (estado.usuario && sessao && sessao.id !== estado.usuario.id) {
            const erro = new Error('outro usuario');
            erro.outroUsuario = sessao;
            throw erro;
        }
    }

    /** " Restam 2 tentativa(s) antes do bloqueio." quando o servidor manda restam. */
    function textoRestam(restam) {
        return restam === null || restam === undefined ? ''
            : ' Restam ' + restam + ' tentativa(s) antes de o login ser bloqueado.';
    }

    /*
     * 409: outra pessoa gravou este registro depois que a janela abriu.
     * Nada foi gravado e o que foi digitado continua na janela. A pessoa
     * escolhe: recarregar o registro (e perder o que digitou) ou copiar o
     * que digitou para colar depois de recarregar.
     */
    function mostrarConflito(mensagem) {
        const botoes = [{ texto: 'Copiar o que digitei', acao: copiarDigitado }];
        if (configModal && configModal.recarregar) {
            const recarregar = configModal.recarregar;
            botoes.unshift({ texto: 'Recarregar (perde o que digitei)', acao: function () {
                fecharModal();
                recarregar();
            } });
        }
        mostrarErroNoModal(mensagem + ' Nada foi gravado.', botoes);
    }

    /* O valor de um campo como a pessoa o ve: lista pelo rotulo escolhido. */
    function valorLegivel(campo) {
        if (campo.tagName === 'SELECT') return campo.selectedOptions[0] ? campo.selectedOptions[0].textContent : '';
        if (campo.type === 'checkbox') return campo.checked ? 'Sim' : 'Não';
        return campo.value;
    }

    /*
     * So o que a PESSOA mexeu, "Rotulo: valor" por linha - inclusive o que
     * escolheu em listas, pelo nome. Zero que a tela pos sozinha nao entra.
     * As linhas dos editores (itens, pagamentos) entram inteiras se alguma
     * foi mexida. Copia para a area de transferencia e deixa o texto
     * selecionado no aviso, caso o navegador nao deixe copiar sozinho.
     */
    function copiarDigitado() {
        const linhas = [];
        modalCorpo.querySelectorAll('.campo').forEach(function (bloco) {
            const rotulo = bloco.querySelector('label');
            Array.from(bloco.querySelectorAll('input, select, textarea')).forEach(function (campo) {
                if (!alterados.has(campo) || !rotulo) return;
                const valor = valorLegivel(campo);
                if (valor !== '') linhas.push(rotulo.textContent.trim() + ': ' + valor);
            });
        });
        modalCorpo.querySelectorAll('[data-editor]').forEach(function (editor) {
            const mexido = Array.from(editor.querySelectorAll('input, select')).some(function (c) { return alterados.has(c); });
            if (!mexido) return;
            const titulo = editor.querySelector('h4');
            editor.querySelectorAll('.item-linha, .pagamento-linha').forEach(function (linha) {
                const partes = Array.from(linha.querySelectorAll('select, input')).map(valorLegivel).filter(Boolean);
                if (partes.length) linhas.push((titulo ? titulo.textContent.trim() : 'Linha') + ': ' + partes.join(' | '));
            });
        });
        const caixa = modalForm.querySelector('.modal-erro');
        let area = caixa.querySelector('textarea');
        if (!area) {
            area = document.createElement('textarea');
            area.className = 'copia-digitado';
            area.rows = Math.min(8, linhas.length + 1);
            caixa.appendChild(area);
        }
        area.value = linhas.join('\n');
        area.select();
        let copiou = false;
        try { copiou = document.execCommand('copy'); } catch (erro) { copiou = false; }
        avisar(copiou ? 'O que você digitou foi copiado. Recarregue e cole nos campos.'
                      : 'Selecione o texto no aviso e copie com Ctrl+C.');
    }

    // ------------------------------------------------------------------
    // Campos do formulario
    // ------------------------------------------------------------------
    function campoHtml(campo) {
        const id = 'campo-' + campo.nome;
        const valor = campo.valor === null || campo.valor === undefined ? '' : String(campo.valor);
        const obrigatorio = campo.obrigatorio ? ' required' : '';
        const desabilitado = campo.desabilitado ? ' disabled' : '';

        if (campo.tipo === 'oculto') {
            return '<input type="hidden" name="' + campo.nome + '" value="' + escapar(valor) + '">';
        }
        if (campo.tipo === 'html') return campo.html;          // bloco pronto
        if (tiposDeCampo[campo.tipo]) return tiposDeCampo[campo.tipo](campo);   // itens, pagamentos

        let controle;
        if (campo.tipo === 'textarea') {
            controle = '<textarea id="' + id + '" name="' + campo.nome + '" rows="2"' + obrigatorio + '>' +
                       escapar(valor) + '</textarea>';
        } else if (campo.tipo === 'select' || campo.tipo === 'select-novo') {
            controle = '<select id="' + id + '" name="' + campo.nome + '"' + desabilitado +
                       (campo.tipo === 'select-novo' ? ' data-campo-novo="' + campo.campoNovo + '"' : '') + '>' +
                campo.opcoes.map(function (opcao) {
                    return '<option value="' + escapar(opcao.valor) + '"' +
                           (String(opcao.valor) === valor ? ' selected' : '') + '>' + escapar(opcao.rotulo) + '</option>';
                }).join('') + '</select>';

            /* O "cadastrar novo" nasce escondido e so aparece com o select
               vazio: dois lugares para a mesma coisa seriam preenchidos os dois.
               O cliente pede tambem o telefone, que e o que identifica a
               pessoa quando ela volta. */
            if (campo.tipo === 'select-novo') {
                const novos = [{ nome: campo.campoNovo, rotulo: campo.rotuloNovo }].concat(campo.extras || []);
                controle += '<div class="oculta" data-novo-de="' + campo.nome +
                            '" style="margin-top:10px;display:grid;gap:12px">' +
                    novos.map(function (n) {
                        return '<div class="campo">' +
                            '<label for="campo-' + n.nome + '">' + escapar(n.rotulo) + '</label>' +
                            (n.lista
                                ? controleLista({ nome: n.nome, lista: n.lista, valor: '' }, 'campo-' + n.nome, '')
                                : '<input type="text" id="campo-' + n.nome + '" name="' + n.nome + '" value=""' +
                                  (n.exemplo ? ' placeholder="' + escapar(n.exemplo) + '"' : '') + '>') +
                            '</div>';
                    }).join('') + '</div>';
            }
        } else if (campo.tipo === 'lista') {
            controle = controleLista(campo, id, desabilitado);
        } else if (campo.tipo === 'checkbox') {
            /* Interruptor: o <input> real fica atras do desenho (nao some),
               alcancavel pelo teclado e pelo leitor de tela. */
            controle = '<label class="interruptor">' +
                '<input type="checkbox" id="' + id + '" name="' + campo.nome + '"' +
                    (campo.valor ? ' checked' : '') + desabilitado +
                    (campo.revela ? ' data-revela="' + escapar(campo.revela) + '"' : '') + '>' +
                '<span class="interruptor-trilho"><span class="interruptor-bola"></span></span>' +
                '<span class="interruptor-texto">' + escapar(campo.textoSim || 'Sim') + '</span>' +
                '</label>';
        } else {
            controle = '<input type="' + (campo.tipo || 'text') + '" id="' + id + '" name="' + campo.nome +
                       '" value="' + escapar(valor) + '"' + limitesNumericos(campo) + obrigatorio + desabilitado +
                       (campo.somenteLeitura ? ' readonly' : '') +
                       (campo.tipo === 'password' && campo.minimo ? ' minlength="' + escapar(campo.minimo) + '"' : '') +
                       (campo.autocomplete ? ' autocomplete="' + escapar(campo.autocomplete) + '"' : '') + '>';
        }

        return '<div class="campo' + (campo.largura === 'total' ? ' campo-total' : '') + '">' +
               '  <label for="' + id + '">' + escapar(campo.rotulo) + '</label>' + controle +
               (campo.dica ? '<small class="dica">' + escapar(campo.dica) + '</small>' : '') +
               '</div>';
    }

    /*
     * Campo de LISTA (marca, armazenamento, cor, categoria): um select com
     * os valores de /api/listas e, ao lado, "+ Nova ...", que abre uma
     * caixinha e cadastra o valor ali mesmo (POST /api/listas), sem sair do
     * formulario. O valor gravado e TEXTO: um valor que ja saiu da lista
     * continua aparecendo no registro que o usa. Quem confere a grafia e o
     * servidor ("apple" grava "Apple").
     */
    const NOVO_DA_LISTA = {
        marcas: 'Nova marca', armazenamentos: 'Novo armazenamento', cores: 'Nova cor',
        categorias_produto: 'Nova categoria', categorias_lancamento: 'Nova categoria',
    };

    function controleLista(campo, id, desabilitado) {
        const valor = campo.valor === null || campo.valor === undefined ? '' : String(campo.valor);
        const valores = ((estado.listas || {})[campo.lista] || []).map(function (v) { return v.valor; });
        const igual = function (a, b) { return a.toLocaleLowerCase('pt-BR') === b.toLocaleLowerCase('pt-BR'); };
        if (valor && !valores.some(function (v) { return igual(v, valor); })) valores.unshift(valor);
        const textoNovo = NOVO_DA_LISTA[campo.lista] || 'Novo valor';
        return '<div class="lista-campo" data-lista="' + escapar(campo.lista) + '">' +
            '<select id="' + id + '" name="' + campo.nome + '"' + (desabilitado || '') + '>' +
                '<option value="">' + escapar(campo.vazio || '— não informado —') + '</option>' +
                valores.map(function (v) {
                    return '<option value="' + escapar(v) + '"' + (valor && igual(v, valor) ? ' selected' : '') + '>' +
                           escapar(v) + '</option>';
                }).join('') +
            '</select>' +
            (desabilitado ? '' : '<button type="button" class="botao-icone lista-novo" data-lista-novo>+ ' + escapar(textoNovo) + '</button>') +
            '<div class="lista-novo-caixa oculta">' +
                '<input type="text" maxlength="60" data-lista-digitado aria-label="' + escapar(textoNovo) + '" placeholder="' +
                    escapar(textoNovo) + '">' +
                '<button type="button" class="botao botao-pequeno" data-lista-gravar>Adicionar</button>' +
                '<button type="button" class="botao-icone" data-lista-cancelar>Cancelar</button>' +
            '</div>' +
            '</div>';
    }

    function abrirNovoDaLista(bloco, abrir) {
        bloco.querySelector('.lista-novo-caixa').classList.toggle('oculta', !abrir);
        const botao = bloco.querySelector('[data-lista-novo]');
        if (botao) botao.classList.toggle('oculta', abrir);
        const caixa = bloco.querySelector('[data-lista-digitado]');
        caixa.value = '';
        if (abrir) caixa.focus(); else bloco.querySelector('select').focus();
    }

    async function gravarNovoDaLista(bloco) {
        const caixa = bloco.querySelector('[data-lista-digitado]');
        const digitado = caixa.value.trim();
        if (!digitado) { caixa.focus(); return; }
        const lista = bloco.dataset.lista;
        const botao = bloco.querySelector('[data-lista-gravar]');
        botao.disabled = true;
        try {
            const r = await api.post('/listas', { lista: lista, valor: digitado });
            estado.listas = estado.listas || {};
            estado.listas[lista] = estado.listas[lista] || [];
            if (!estado.listas[lista].some(function (v) { return v.valor === r.valor; })) {
                estado.listas[lista].push({ id: r.id, valor: r.valor, ativo: true });
            }
            const select = bloco.querySelector('select');
            if (!Array.from(select.options).some(function (o) { return o.value === r.valor; })) {
                const opcao = document.createElement('option');
                opcao.value = r.valor;
                opcao.textContent = r.valor;
                select.appendChild(opcao);
            }
            select.value = r.valor;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            abrirNovoDaLista(bloco, false);
            avisar(r.mensagem || 'Cadastrado.');
        } catch (erro) {
            avisar(erro.message, 'erro');
            caixa.focus();
        } finally {
            botao.disabled = false;
        }
    }

    modalCorpo.addEventListener('click', function (evento) {
        const bloco = evento.target.closest('.lista-campo');
        if (!bloco) return;
        if (evento.target.closest('[data-lista-novo]')) abrirNovoDaLista(bloco, true);
        else if (evento.target.closest('[data-lista-cancelar]')) abrirNovoDaLista(bloco, false);
        else if (evento.target.closest('[data-lista-gravar]')) gravarNovoDaLista(bloco);
    });

    /* Enter na caixinha cadastra (e nao envia o formulario); Esc fecha so a caixinha. */
    modalCorpo.addEventListener('keydown', function (evento) {
        if (!evento.target.matches('[data-lista-digitado]')) return;
        const bloco = evento.target.closest('.lista-campo');
        if (evento.key === 'Enter') { evento.preventDefault(); gravarNovoDaLista(bloco); }
        if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); abrirNovoDaLista(bloco, false); }
    });

    /*
     * Limites de um campo numerico, todos do /api/config.
     * Passo: dinheiro anda de centavo em centavo; quantidade, parcela e dia
     * sao inteiros. Minimo: zero, salvo quando o campo pede outro. Maximo:
     * dinheiro sempre tem o teto config.valor_maximo; os outros campos
     * dizem o seu (quantidade_maxima, parcelas_max, garantia_maxima...).
     */
    function limitesNumericos(campo) {
        if (campo.tipo !== 'number') return '';
        const passo = String(campo.passo || '0.01');
        const minimo = campo.minimo !== undefined ? campo.minimo : 0;
        const maximo = campo.maximo !== undefined ? campo.maximo
                     : (passo === '0.01' ? estado.config.valor_maximo : undefined);
        return ' step="' + escapar(passo) + '" min="' + escapar(minimo) + '"' +
               (maximo !== undefined ? ' max="' + escapar(maximo) + '"' : '');
    }

    /* Interruptor que revela outro campo (garantia -> periodo): o campo
       revelado some de verdade quando desmarcado. */
    function ligarInterruptores() {
        modalCorpo.querySelectorAll('input[type="checkbox"][data-revela]').forEach(function (caixa) {
            const alvo = modalCorpo.querySelector('[name="' + caixa.dataset.revela + '"]');
            if (!alvo) return;
            const bloco = alvo.closest('.campo');
            function ajustar() { bloco.classList.toggle('oculta', !caixa.checked); }
            caixa.addEventListener('change', ajustar);
            ajustar();
        });
    }

    /** Mostra ou esconde o "cadastrar novo" conforme o select. */
    function ligarSelectNovo() {
        modalCorpo.querySelectorAll('select[data-campo-novo]').forEach(function (select) {
            const caixa = modalCorpo.querySelector('[data-novo-de="' + select.name + '"]');
            if (!caixa) return;
            function ajustar() {
                caixa.classList.toggle('oculta', select.value !== '');
                if (select.value !== '') {
                    caixa.querySelectorAll('input').forEach(function (i) { i.value = ''; });
                    caixa.querySelectorAll('select').forEach(function (s) { s.value = ''; });
                }
            }
            select.addEventListener('change', ajustar);
            ajustar();
        });
    }

    function valoresDoModal() {
        const valores = {};
        modalCorpo.querySelectorAll('input, select, textarea').forEach(function (elemento) {
            // Os editores (itens, pagamentos) tem nomes repetidos por linha:
            // quem le e o gancho "coletar" de cada um.
            if (elemento.closest('[data-editor]')) return;
            if (!elemento.name) return;
            // Caixa de marcar responde por .checked; .value diria "on" mesmo desmarcada.
            valores[elemento.name] = elemento.type === 'checkbox' ? (elemento.checked ? 1 : 0) : elemento.value;
        });

        // Garantia desligada = zero dias (o periodo escondido nao vale).
        if ('tem_garantia' in valores) {
            if (!valores.tem_garantia) valores.garantia_dias = 0;
            delete valores.tem_garantia;
        }
        ganchos.coletar.forEach(function (f) { f(valores); });
        return valores;
    }

    modalForm.addEventListener('submit', async function (evento) {
        evento.preventDefault();
        if (!aoSalvarModal) return;

        const botao = document.getElementById('modalSalvar');
        botao.disabled = true;
        limparErroDoModal();
        try {
            await conferirMesmoUsuario();
            await aoSalvarModal(valoresDoModal());
            fecharModal();
        } catch (erro) {
            // A janela fica aberta com tudo o que foi digitado.
            if (erro.outroUsuario) mostrarUsuarioTrocado(erro.outroUsuario);
            else if (erro.status === 401) pedirLoginNaJanela(erro.message);
            else if (erro.status === 409) mostrarConflito(erro.message);
            else mostrarErroNoModal(erro.message);
        } finally {
            botao.disabled = false;
            ganchos.depoisDeFalhar.forEach(function (f) { f(); });
        }
    });

    document.getElementById('modalFechar').addEventListener('click', fecharModal);
    document.getElementById('modalCancelar').addEventListener('click', fecharModal);

    /*
     * Clicar fora ou Esc nao fecha o cadastro: a janela treme e o aviso no
     * rodape diz por onde se sai. A janela de leitura (historico, ver venda)
     * fecha com clique fora e Esc: nao ha nada digitado ali.
     */
    let tremendo = null;

    function recusarFechamento() {
        const caixa = modal.querySelector('.modal-caixa');
        caixa.classList.remove('tremendo');
        void caixa.offsetWidth;    // reinicia a animacao a cada clique
        caixa.classList.add('tremendo');
        clearTimeout(tremendo);
        tremendo = setTimeout(function () { caixa.classList.remove('tremendo'); }, 500);

        if (!modal.querySelector('.modal-aviso')) {
            const aviso = document.createElement('div');
            aviso.className = 'modal-aviso';
            aviso.innerHTML = 'Para fechar, use <strong>Cancelar</strong> ou o <strong>×</strong> — ' +
                              'assim você não perde o que digitou.';
            modalForm.querySelector('.modal-rodape').prepend(aviso);
            setTimeout(function () { aviso.classList.add('sumindo'); }, 3800);
            setTimeout(function () { aviso.remove(); }, 4300);
        }
    }

    modal.addEventListener('click', function (evento) {
        if (evento.target !== modal) return;
        if (modal.dataset.somenteLeitura === '1') { fecharModal(); return; }
        recusarFechamento();
    });

    document.addEventListener('keydown', function (evento) {
        if (evento.key !== 'Escape' || !aberta()) return;
        if (modal.dataset.somenteLeitura === '1') { fecharModal(); return; }
        recusarFechamento();
    });

    janela.Janela = {
        modalCorpo: modalCorpo, ganchos: ganchos, registrarTipoDeCampo: registrarTipoDeCampo,
        abrirModal: abrirModal, fecharModal: fecharModal, aberta: aberta,
        formularioAberto: formularioAberto, formularioAlterado: formularioAlterado, configAtual: configAtual,
        mostrarErroNoModal: mostrarErroNoModal, recusarFechamento: recusarFechamento,
        textoRestam: textoRestam,
    };
})(window);
