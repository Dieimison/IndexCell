// carga: usa Formato, RegrasOs, Nucleo, Janela, Editores; publica Telas.os  (conferido por testes/front/carga.test.js)
/*
 * telas/os.js - Ordens de servico. Window.Telas.os.
 */
(function (janela) {
    'use strict';

    const { escapar, moeda, dataCurta, horaCurta, emCentavos, deCentavos } = janela.Formato;
    const { calcularValoresOs, digitadosIniciais } = janela.RegrasOs;
    const N = janela.Nucleo;
    const { api, estado, mensagemDe, avisar, dominio, rotuloDe, corDe, etiqueta, vazio, opcoesDe, nomeModelo,
            tabelaHtml, carregarCatalogos, carregarDisponiveis, carregarMovimentaveis } = N;
    const { abrirModal, modalCorpo } = janela.Janela;
    const { totaisDoEditor } = janela.Editores;

    // ==================================================================
    // 4c. Ordens de servico
    // ==================================================================
    async function carregarOs() {
        const [ordens] = await Promise.all([api.get('/os'), carregarCatalogos(), carregarDisponiveis()]);
        estado.os = ordens.itens;
        desenharOs();
    }

    function desenharOs() {
        const busca = document.getElementById('buscaOs').value.trim().toLowerCase();
        const status = document.getElementById('filtroStatus').value;

        const itens = estado.os.filter(function (os) {
            if (status === 'abertas') {
                if (estado.config.status_os_em_andamento.indexOf(os.status) === -1) return false;
            } else if (status && os.status !== status) {
                return false;
            }
            if (!busca) return true;
            return [os.numero, os.cliente, os.aparelho, os.defeito_relatado, os.cliente_telefone]
                .join(' ').toLowerCase().includes(busca);
        });

        const alvo = document.getElementById('listaOs');
        if (!itens.length) {
            alvo.innerHTML = vazio('Nenhuma ordem de serviço encontrada. Use o botão "Nova ordem de serviço" para abrir a primeira.');
            return;
        }

        alvo.innerHTML =
            '<div class="rolagem-x"><table>' +
            '<thead><tr><th>Número</th><th>Cliente</th><th>Aparelho</th><th>Status</th><th>Peças</th><th>Valor</th>' +
            '<th>Entrada</th><th class="coluna-acoes">Ações</th></tr></thead><tbody>' +
            itens.map(function (os) {
                return '<tr>' +
                    '<td>' + escapar(os.numero || ('#' + os.id)) + '</td>' +
                    '<td>' + escapar(os.cliente) +
                        (os.cliente_telefone ? '<br><small class="observacao">' + escapar(os.cliente_telefone) + '</small>' : '') + '</td>' +
                    '<td>' + escapar(os.aparelho || '—') +
                        (os.defeito_relatado ? '<br><small class="observacao">' + escapar(os.defeito_relatado) + '</small>' : '') + '</td>' +
                    '<td>' + etiqueta('status_os', os.status) + '</td>' +
                    '<td>' + moeda(os.valor_pecas) + '</td>' +
                    '<td>' + moeda(os.valor_final || os.valor_orcamento) + '</td>' +
                    '<td>' + dataCurta(os.data_entrada) + '</td>' +
                    '<td class="coluna-acoes">' +
                    '  <button type="button" class="botao-icone" data-acao="editar-os" data-id="' + os.id + '">Editar</button>' +
                    '  <button type="button" class="botao-icone" data-acao="historico-os" data-id="' + os.id + '">Histórico</button>' +
                    '  <button type="button" class="botao-icone" data-acao="movimentar-os" data-id="' + os.id + '" title="Peça com defeito, devolução ou garantia">Garantia</button>' +
                    // O servidor diz, por OS, se ela pode ser excluida.
                    (os.pode_excluir
                        ? '  <button type="button" class="botao-icone perigo" data-acao="excluir-os" data-id="' + os.id + '">Excluir</button>'
                        : '') +
                    '</td></tr>';
            }).join('') +
            '</tbody></table></div>';
    }

    /*
     * A trilha de status no topo da OS.
     *
     * O caminho normal de um conserto é sempre o mesmo: entra, é orçado,
     * aprovado, consertado, fica pronto e sai. Mostrar isso como uma trilha
     * responde de relance "em que pé está?", coisa que um <select> com oito
     * opções não responde.
     *
     * Recusada e cancelada não estão na trilha: são saídas do caminho, não
     * etapas dele. Quando a OS está numa delas, a trilha inteira aparece
     * apagada com o aviso do desfecho.
     */
    const FORA_DA_TRILHA = ['recusada', 'cancelada'];

    /* Os status da trilha, na ordem do servidor (config.dominios.status_os). */
    function trilhaOs() {
        return dominio('status_os').map(function (d) { return d.valor; })
            .filter(function (v) { return FORA_DA_TRILHA.indexOf(v) === -1; });
    }

    function painelStatusOs(os) {
        const atual = os.status || 'aberta';
        const trilha = trilhaOs();
        const fora = trilha.indexOf(atual) === -1;
        const posicao = trilha.indexOf(atual);

        const passos = trilha.map(function (chave, i) {
            const feito = !fora && i < posicao;
            const agora = !fora && i === posicao;
            return '<div class="passo' + (feito ? ' feito' : '') + (agora ? ' agora' : '') + '"' +
                   (agora ? ' style="--cor-passo:var(' + corDe('status_os', chave) + ')"' : '') + '>' +
                   '  <span class="passo-bola">' + (feito ? '✓' : (i + 1)) + '</span>' +
                   '  <span class="passo-nome">' + escapar(rotuloDe('status_os', chave)) + '</span>' +
                   '</div>';
        }).join('<span class="passo-linha"></span>');

        // Barra de progresso atrás da trilha: a fração já percorrida.
        const progresso = fora ? 0 : (posicao / (trilha.length - 1)) * 100;

        const numero = os.numero || (os.id ? 'OS #' + os.id : 'Nova ordem');
        const cor = 'var(' + corDe('status_os', atual) + ')';

        return '<div class="painel-os campo-total">' +
            '  <div class="painel-os-topo">' +
            '    <div>' +
            '      <div class="painel-os-numero">' + escapar(numero) + '</div>' +
            (os.cliente ? '      <div class="painel-os-sub">' + escapar(os.cliente) +
                          (os.aparelho ? ' &bull; ' + escapar(os.aparelho) : '') + '</div>' : '') +
            '    </div>' +
            '    <div class="painel-os-etiqueta" style="--cor-status:' + cor + '">' +
            '      <span class="pulso"></span>' + escapar(rotuloDe('status_os', atual)) +
            '    </div>' +
            '  </div>' +
            (fora
                ? '<div class="painel-os-encerrado">Esta ordem foi <strong>' +
                  escapar(rotuloDe('status_os', atual)) + '</strong> e não segue o fluxo normal.</div>'
                : '<div class="trilha"><div class="trilha-progresso" style="width:' + progresso.toFixed(1) + '%"></div>' +
                  passos + '</div>') +
            (os.id ? '<div class="painel-os-numeros">' +
                  painelNumero('Peças', moeda(os.valor_pecas)) +
                  painelNumero('Mão de obra', moeda(os.valor_mao_obra)) +
                  painelNumero('Valor final', moeda(os.valor_final), true) +
                  painelNumero('Entrada', dataCurta(os.data_entrada)) +
                  (Number(os.garantia_dias) > 0
                      ? painelNumero('Garantia', os.garantia_dias + ' dias')
                      : painelNumero('Garantia', 'sem garantia')) +
                  '</div>' : '') +
            '</div>';
    }

    function painelNumero(rotulo, valor, destaque) {
        return '<div class="painel-os-numero-item' + (destaque ? ' destaque' : '') + '">' +
               '  <span>' + escapar(rotulo) + '</span><strong>' + escapar(valor) + '</strong>' +
               '</div>';
    }

    /*
     * Formulario da OS. Cliente vem do cadastro (select puro, sem digitar) e o
     * modelo vem do catalogo, com o atalho de cadastrar na hora. As pecas nao
     * sao mais um valor digitado: entram pelo editor de itens, que so oferece
     * o que existe no estoque com saldo.
     *
     * Em edicao, todo campo abre com o que esta GRAVADO (ver ligarCalculoDaOs)
     * e o atualizado_em vai junto no PUT: se outra aba mexeu na OS depois que
     * esta abriu, o servidor recusa com 409 em vez de gravar por cima.
     */
    function formularioOs(os) {
        os = os || {};
        const campos = [];

        if (os.id) {
            campos.push({ nome: 'atualizado_em', tipo: 'oculto', valor: os.atualizado_em || '' });
        }

        campos.push({ nome: '__painel', tipo: 'html', html: painelStatusOs(os) });

        campos.push({
            nome: 'cliente_id', rotulo: 'Cliente', tipo: 'select-novo', valor: os.cliente_id || '',
            opcoes: opcoesDe(estado.clientes, function (c) {
                return c.nome + (c.telefone ? ' (' + c.telefone + ')' : '');
            }, '— cadastrar cliente novo —'),
            campoNovo: 'cliente_nome', rotuloNovo: 'Nome do cliente novo',
            extras: [{ nome: 'cliente_telefone', rotulo: 'Telefone', exemplo: '(00) 00000-0000' }],
            dica: 'Escolha na lista. Se for a primeira vez do cliente na loja, digite o nome e ele é cadastrado na hora.',
            largura: 'total',
        });

        campos.push({
            nome: 'modelo_id', rotulo: 'Modelo do celular', tipo: 'select-novo',
            valor: os.modelo_id || '',
            opcoes: opcoesDe(estado.modelos, nomeModelo, '— cadastrar um modelo novo —'),
            campoNovo: 'modelo_nome', rotuloNovo: 'Nome do modelo novo',
            extras: [{ nome: 'marca', rotulo: 'Marca do modelo novo', lista: 'marcas' },
                     { nome: 'armazenamento', rotulo: 'Armazenamento do modelo novo', lista: 'armazenamentos' }],
            dica: 'Escolha na lista. Se o modelo ainda não existe, digite o nome que ele é cadastrado na hora.',
            largura: 'total',
        });

        campos.push({ nome: 'imei', rotulo: 'IMEI', valor: os.imei });
        campos.push({ nome: 'cor', rotulo: 'Cor', tipo: 'lista', lista: 'cores', valor: os.cor });
        campos.push({ nome: 'senha_aparelho', rotulo: 'Senha / padrão', valor: os.senha_aparelho });
        campos.push({ nome: 'acessorios', rotulo: 'Acessórios entregues', valor: os.acessorios });

        /*
         * Status: so os que o servidor permite a partir do atual
         * (os.status_permitidos). Sem para onde ir, o campo some e uma frase
         * diz por que: OS cancelada (abrir outra) ou OS entregue e paga para
         * quem nao e admin (so o administrador reabre).
         */
        const permitidos = os.id && Array.isArray(os.status_permitidos)
            ? os.status_permitidos : dominio('status_os').map(function (d) { return d.valor; });
        if (os.id && os.status === 'cancelada' && !permitidos.filter(function (s) { return s !== 'cancelada'; }).length) {
            campos.push({ nome: '__status', tipo: 'html', html:
                '<div class="aviso-formulario campo-total">Esta OS está <strong>cancelada</strong> e não pode ser reaberta. ' +
                'Para atender o mesmo aparelho, abra uma nova ordem de serviço.</div>' });
        } else if (os.id && os.status === 'entregue' && Number(os.pagamentos_recebidos) > 0 &&
                   !permitidos.filter(function (s) { return s !== 'entregue'; }).length) {
            campos.push({ nome: '__status', tipo: 'html', html:
                '<div class="aviso-formulario campo-total">Só o administrador pode reabrir uma OS entregue e paga.</div>' });
        } else {
            const lista = permitidos.indexOf(os.status) === -1 && os.status ? [os.status].concat(permitidos) : permitidos;
            campos.push({
                nome: 'status', rotulo: 'Status', tipo: 'select', valor: os.status || lista[0],
                opcoes: lista.map(function (s) { return { valor: s, rotulo: rotuloDe('status_os', s) }; }),
            });
        }
        campos.push({ nome: 'data_previsao', rotulo: 'Previsão de entrega', tipo: 'date', valor: (os.data_previsao || '').substring(0, 10) });

        campos.push({ nome: 'defeito_relatado', rotulo: 'Defeito relatado pelo cliente', tipo: 'textarea', valor: os.defeito_relatado, largura: 'total' });
        campos.push({ nome: 'diagnostico', rotulo: 'Diagnóstico técnico', tipo: 'textarea', valor: os.diagnostico, largura: 'total' });
        campos.push({ nome: 'servico_executado', rotulo: 'Serviço executado', tipo: 'textarea', valor: os.servico_executado, largura: 'total' });

        campos.push({
            nome: 'itens', tipo: 'itens', titulo: 'Peças e produtos usados',
            valor: os.lista_itens || [],
            // Peça só entra e sai enquanto o serviço está em andamento (ver
            // itensTravados): depois de pronta, mexer aqui mudaria o estoque
            // de um serviço que já foi fechado.
            travado: itensTravados(os.status) ? os.status : '',
        });

        campos.push({ nome: 'valor_orcamento', rotulo: 'Orçamento (R$)', tipo: 'number', valor: os.valor_orcamento,
                      dica: 'O preço combinado com o cliente. Numa OS nova, sugere a mão de obra (orçamento menos peças).' });
        campos.push({ nome: 'valor_mao_obra', rotulo: 'Mão de obra (R$)', tipo: 'number', valor: os.valor_mao_obra,
                      dica: 'Com serviços lançados: é a soma deles. Sem serviços: o valor digitado.' });
        campos.push({
            nome: 'valor_final', rotulo: 'Valor final (R$)', tipo: 'number', valor: os.valor_final,
            dica: 'Peças + mão de obra, a não ser que você digite outro valor (desconto de balcão, por exemplo).',
        });
        /* Uma OS pode ser paga em mais de uma forma; ver editorPagamentosHtml.
           As OS antigas chegam com uma linha so, convertida na migracao. */
        campos.push({ nome: '__pagamentos', tipo: 'pagamentos', largura: 'total',
                      valor: os.pagamentos || [] });

        /*
         * Garantia: primeiro a pergunta (dá ou não dá), depois por quanto
         * tempo, numa lista (o padrão e o teto vêm do /api/config).
         */
        const temGarantia = os.id ? Number(os.garantia_dias) > 0 : true;
        const padrao = estado.config.garantia_padrao;
        const prazos = [30, 60, 90, 180, 365].filter(function (d) { return d <= estado.config.garantia_maxima; });
        if (prazos.indexOf(padrao) === -1) prazos.push(padrao);
        if (os.id && Number(os.garantia_dias) > 0 && prazos.indexOf(Number(os.garantia_dias)) === -1) {
            prazos.push(Number(os.garantia_dias));   // prazo antigo fora da lista continua aparecendo
        }
        prazos.sort(function (a, b) { return a - b; });
        campos.push({
            nome: 'tem_garantia', rotulo: 'Dar garantia?', tipo: 'checkbox',
            valor: temGarantia, textoSim: 'Sim, com garantia', revela: 'garantia_dias',
        });
        campos.push({
            nome: 'garantia_dias', rotulo: 'Período de garantia', tipo: 'select',
            valor: String(os.id && Number(os.garantia_dias) > 0 ? os.garantia_dias : padrao),
            opcoes: prazos.map(function (d) {
                const nome = d === 180 ? '6 meses' : d === 365 ? '1 ano' : d + ' dias';
                return { valor: String(d), rotulo: nome + (d === padrao ? ' (padrão)' : '') };
            }),
            escondidoSe: !temGarantia,
        });

        campos.push({ nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', valor: os.observacoes, largura: 'total' });

        return campos;
    }

    /*
     * Status em que a lista de peças não pode mais ser mexida.
     *
     * Uma OS pronta ou entregue já baixou as peças do estoque e já pode ter
     * virado conta a receber. Tirar um item ali dentro devolveria a peça à
     * prateleira sem que ninguém a tenha devolvido de verdade.
     *
     * A lista é a do servidor (config.status_os_itens_travados), que é quem
     * de fato recusa a gravação; a tela só não oferece o que vai ser recusado.
     */
    function itensTravados(status) {
        return !!status && estado.config.status_os_itens_travados.indexOf(status) !== -1;
    }

    async function verHistorico(id) {
        const dados = await api.get('/os/' + id);
        const os = dados.os;

        const linhas = (os.historico || []).map(function (h) {
            return '<li><strong>' + escapar(rotuloDe('status_os', h.status_para)) + '</strong>' +
                (h.status_de ? ' <span class="observacao">(era ' + escapar(rotuloDe('status_os', h.status_de)) + ')</span>' : '') +
                '<br><small class="observacao">' + dataCurta(h.criado_em) + ' ' + escapar(horaCurta(h.criado_em)) +
                (h.usuario_nome ? ' por ' + escapar(h.usuario_nome) : '') + '</small>' +
                (h.comentario ? '<br><small>' + escapar(h.comentario) + '</small>' : '') +
                '</li>';
        }).join('');

        const itens = (os.lista_itens || []).length
            ? '<table><thead><tr><th>Item</th><th>Qtd</th><th>Unitário</th><th>Subtotal</th></tr></thead><tbody>' +
              os.lista_itens.map(function (i) {
                  return '<tr><td>' + escapar(i.descricao) + '</td><td>' + i.quantidade + '</td>' +
                         '<td>' + moeda(i.valor_unitario) + '</td><td>' + moeda(i.subtotal) + '</td></tr>';
              }).join('') +
              '<tr class="linha-total"><td colspan="3"><strong>Total em peças</strong></td>' +
              '<td><strong>' + moeda(os.valor_pecas) + '</strong></td></tr></tbody></table>'
            : vazio('Nenhuma peça lançada nesta OS.');

        abrirModal({
            titulo: 'Histórico da ' + (os.numero || 'OS #' + os.id),
            somenteLeitura: true,
            html: '<div class="campo-total"><h4 class="sub-titulo">Peças e produtos</h4>' + itens +
                  '<h4 class="sub-titulo">Mudanças de status</h4>' +
                  (linhas ? '<ul class="historico">' + linhas + '</ul>' : vazio('Sem histórico registrado.')) +
                  '</div>',
        });
    }

    /*
     * As contas da OS. A regra mora em os-regras.js (calcularValoresOs), a
     * mesma do servidor e conferida pela mesma tabela de casos
     * (testes\casos\mao-de-obra.json). O que conta como DIGITADO ao abrir
     * tambem mora la (digitadosIniciais); aqui a tela so le os campos,
     * acompanha o que a pessoa mexe e chama a conta:
     *
     *   - OS gravada (edicao): o que esta gravado conta como digitado, entao
     *     reabrir e salvar sem mexer grava exatamente o mesmo. Quem apaga
     *     um campo devolve aquele numero para a conta.
     *   - OS nova: so o que a pessoa digitou; o resto e sugestao.
     *
     * A conta roda quando alguem mexe no orcamento, nos itens, nos
     * servicos, na mao de obra ou no valor final - nunca ao abrir.
     */
    function ligarCalculoDaOs() {
        const orcamento = modalCorpo.querySelector('[name="valor_orcamento"]');
        const maoObra = modalCorpo.querySelector('[name="valor_mao_obra"]');
        const final = modalCorpo.querySelector('[name="valor_final"]');
        if (!maoObra || !final) return;

        const configuracao = janela.Janela.configAtual();
        const edicao = !!(configuracao && configuracao.edicao);
        const digitado = function (campo) { return campo.value !== '' ? campo.value : null; };

        // O que conta como digitado ao abrir e regra (os-regras.js, testada pela tabela).
        const iniciais = digitadosIniciais(edicao, { mao: maoObra.value, final: final.value });
        let maoDigitada = iniciais.mao_digitada;
        let finalDigitado = iniciais.final_digitado;

        maoObra.addEventListener('input', function () {
            maoDigitada = digitado(maoObra);
            recalcular();
        });
        final.addEventListener('input', function () {
            finalDigitado = digitado(final);
            if (finalDigitado === null) recalcular();
        });

        function recalcular() {
            const t = totaisDoEditor();
            const r = calcularValoresOs({
                orcamento: orcamento ? orcamento.value : 0, pecas: t.pecas, servicos: t.servicos,
                mao_digitada: maoDigitada, final_digitado: finalDigitado,
            });
            marcarMaoDosServicos(t.servicos > 0);
            if (t.servicos > 0 || maoDigitada === null) maoObra.value = r.mao > 0 ? r.mao.toFixed(2) : '';
            if (finalDigitado === null) final.value = r.final > 0 ? r.final.toFixed(2) : '';
            conferirOrcamento();
        }

        /* Com servico lancado, a mao de obra E a soma deles: o campo trava. */
        function marcarMaoDosServicos(temServico) {
            maoObra.readOnly = temServico;
            maoObra.title = temServico ? 'Soma dos serviços lançados acima.' : '';
        }

        /*
         * O que esta LANCADO (pecas + servicos) passando do orcamento
         * combinado e quase sempre erro de digitacao: avisa antes de salvar.
         */
        function conferirOrcamento() {
            const t = totaisDoEditor();
            const orc = emCentavos(orcamento ? orcamento.value : 0);
            const cobrado = emCentavos(t.pecas) + emCentavos(t.servicos);
            avisarOrcamentoCurto(orc > 0 && cobrado > orc + emCentavos(estado.config.tolerancia_centavo),
                                 deCentavos(cobrado), deCentavos(orc));
        }

        if (orcamento) orcamento.addEventListener('input', recalcular);
        modalCorpo.addEventListener('itens-mudaram', function (evento) {
            // Montar o editor ao abrir tambem avisa "itens-mudaram"; isso nao e alguem mexendo.
            if (evento.detail && evento.detail.abertura) return;
            recalcular();
        });

        if (edicao) {
            marcarMaoDosServicos(totaisDoEditor().servicos > 0);   // so a aparencia
            conferirOrcamento();
        } else {
            recalcular();
        }
    }

    /** Mostra (ou tira) o alerta de que as peças passaram do orçamento. */
    function avisarOrcamentoCurto(mostrar, pecas, orcamento) {
        const editor = modalCorpo.querySelector('[data-editor="itens"]');
        if (!editor) return;

        let alerta = editor.querySelector('.alerta-orcamento');

        if (!mostrar) {
            if (alerta) alerta.remove();
            return;
        }
        if (!alerta) {
            alerta = document.createElement('div');
            alerta.className = 'alerta-orcamento';
            editor.appendChild(alerta);
        }
        alerta.innerHTML = 'O que está lançado (<strong>' + escapar(moeda(pecas)) + '</strong>) passa do orçamento (<strong>' +
            escapar(moeda(orcamento)) + '</strong>) combinado com o cliente — confira os valores.';
    }

    document.getElementById('buscaOs').addEventListener('input', desenharOs);

    document.getElementById('filtroStatus').addEventListener('change', desenharOs);

    function abrirEdicaoOs(id) {
        // A OS completa: a lista nao traz os itens ja lancados.
        return api.get('/os/' + id).then(function (dados) {
            return abrirModal({
                titulo: 'Editar ' + (dados.os.numero || 'OS #' + dados.os.id),
                campos: formularioOs(dados.os),
                edicao: true,   // o gravado conta como digitado (ver ligarCalculoDaOs)
                aoAbrir: ligarCalculoDaOs,
                // 409: "Recarregar" abre de novo com o que esta gravado agora.
                recarregar: function () { abrirEdicaoOs(id).catch(function (e) { avisar(e.message, 'erro'); }); },
                aoSalvar: async function (valores) {
                    avisar(mensagemDe(await api.put('/os/' + id, valores), 'Ordem de serviço atualizada.'));
                    await carregarOs();
                },
            });
        });
    }

    N.registrarAcoes({
        'nova-os': function () {
            if (!estado.clientes.length) {
                avisar('Cadastre um cliente antes de abrir a primeira OS (aba Cadastros).', 'erro');
                return;
            }
            return abrirModal({
                titulo: 'Nova ordem de serviço',
                campos: formularioOs(null),
                aoAbrir: ligarCalculoDaOs,
                aoSalvar: async function (valores) {
                    avisar(mensagemDe(await api.post('/os', valores), 'Ordem de serviço criada.'));
                    await carregarOs();
                },
            });
        },
        'editar-os': abrirEdicaoOs,
        'historico-os': verHistorico,
        'excluir-os': async function (id) {
            const os = estado.os.find(function (o) { return o.id === id; });
            if (!confirm('Excluir a ' + (os.numero || 'OS #' + os.id) + '? O histórico também será apagado.')) return;
            avisar(mensagemDe(await api.remover('/os/' + id), 'Ordem de serviço excluída.'));
            await carregarOs();
        },
        /* Chamado de dentro de uma OS: ja traz a ordem preenchida, porque o
           motivo mais comum de mexer no estoque fora do fluxo e uma peca
           que deu problema num conserto. */
        'movimentar-os': async function (id) {
            await carregarMovimentaveis();
            const dados = await api.get('/os/' + id);
            const usados = (dados.os.lista_itens || []).filter(function (i) { return i.entrada_id; });
            return janela.Telas.movimentacao.abrirMovimentacao(
                'Devolução / garantia — ' + (dados.os.numero || 'OS #' + id),
                usados.length ? usados[0].entrada_id : null, id, carregarOs);
        },
    });

    N.registrarTela('os', { titulo: 'Ordens de Serviço', carregar: carregarOs });
    janela.Telas = janela.Telas || {};
    janela.Telas.os = {
        carregarOs: carregarOs,
        // v8: a tela de entrada do PDV abre uma OS da lista "Ultimas ordens de servico".
        abrirOs: async function (id) { await carregarOs(); return abrirEdicaoOs(id); },
        novaOs: async function () { await carregarOs(); return N.executarAcao('nova-os'); },
    };
})(window);
