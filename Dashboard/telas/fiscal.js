// carga: usa Formato, Nucleo, Janela; publica Telas.fiscal  (conferido por testes/front/carga.test.js)
/*
 * telas/fiscal.js - cadastros fiscais (v7). Window.Telas.fiscal. So admin.
 *
 *   Empresa     regime (o CRT sai dele), IE, endereco, UF, codigo IBGE.
 *               Cada campo mudado entra no historico.
 *   CFOP        a tabela de referencia e o que ESTA loja faz com cada um:
 *               permitido, efeito no estoque e no financeiro, observacao.
 *               O CFOP oficial tem a descricao travada; o que faltar o
 *               admin cadastra.
 *   Naturezas   compra para revenda, bonificacao...: o CFOP de dentro e de
 *               fora do estado e o que a operacao faz. O pedido de entrada
 *               escolhe a natureza; o CFOP sai dela.
 *
 * O sistema ainda NAO emite nota: o ambiente fica em homologacao.
 */
(function (janela) {
    'use strict';

    const { escapar, dataCurta, horaCurta } = janela.Formato;
    const N = janela.Nucleo;
    const { api, avisar, mensagemDe, rotuloDe, opcoesDoDominio, etiquetaTexto, tabelaHtml, vazio } = N;
    const { abrirModal } = janela.Janela;

    const raiz = document.getElementById('fiscalConteudo');
    let aba = 'empresa';
    let dados = { fiscal: null, empresa: null, historico: [], cfops: [], naturezas: [] };
    let buscaCfop = '';

    const fmtCfop = function (c) { return c ? String(c).charAt(0) + '.' + String(c).slice(1) : '—'; };
    const CRT = { 1: '1 - Simples Nacional', 2: '2 - Simples Nacional, excesso de sublimite', 3: '3 - Regime normal', 4: '4 - MEI' };

    function campo(id, rotulo, valor, extra) {
        extra = extra || {};
        return '<div class="campo' + (extra.total ? ' campo-total' : '') + '"><label for="' + id + '">' + escapar(rotulo) + '</label>' +
            (extra.opcoes
                ? '<select id="' + id + '" name="' + id.replace('fiscal-', '') + '">' + extra.opcoes.map(function (o) {
                    return '<option value="' + escapar(o.valor) + '"' + (String(o.valor) === String(valor === null ? '' : valor) ? ' selected' : '') + '>' +
                        escapar(o.rotulo) + '</option>';
                }).join('') + '</select>'
                : '<input type="text" id="' + id + '" name="' + id.replace('fiscal-', '') + '" value="' + escapar(valor === null || valor === undefined ? '' : valor) +
                    '"' + (extra.max ? ' maxlength="' + extra.max + '"' : '') + (extra.dica ? ' aria-describedby="' + id + '-dica"' : '') + '>') +
            (extra.dica ? '<small class="dica" id="' + id + '-dica">' + escapar(extra.dica) + '</small>' : '') + '</div>';
    }

    function desenharEmpresa() {
        const f = dados.fiscal;
        const ufs = [{ valor: '', rotulo: '— escolha —' }].concat(opcoesDoDominio('ufs').map(function (u) {
            return { valor: u.valor, rotulo: u.valor + ' - ' + u.rotulo };
        }));
        return '<div class="table-section">' +
            '<h3 class="table-title"><span style="background:var(--serie-3)"></span>Dados fiscais de ' + escapar(dados.empresa.nome) + '</h3>' +
            '<p class="secao-descricao">Nome, razão social e CNPJ ficam em Administrativo > Empresa e regras > Empresa. O CRT da nota sai do regime: ' +
                '<strong>' + escapar(f.crt ? CRT[f.crt] : 'escolha o regime') + '</strong>. Confirme o regime com o contador.</p>' +
            '<form id="formFiscal" class="formulario">' +
                campo('fiscal-regime', 'Regime tributário', f.regime || '', { opcoes: [{ valor: '', rotulo: '— escolha —' }].concat(opcoesDoDominio('regimes')) }) +
                campo('fiscal-ie', 'Inscrição estadual', f.ie, { dica: 'Só números, ou ISENTO.', max: 20 }) +
                campo('fiscal-im', 'Inscrição municipal', f.im, { max: 20 }) +
                campo('fiscal-cnae', 'CNAE principal', f.cnae, { max: 10 }) +
                campo('fiscal-logradouro', 'Endereço (rua)', f.logradouro, { total: true, max: 120 }) +
                campo('fiscal-numero', 'Número', f.numero, { max: 10 }) +
                campo('fiscal-complemento', 'Complemento', f.complemento, { max: 60 }) +
                campo('fiscal-bairro', 'Bairro', f.bairro, { max: 60 }) +
                campo('fiscal-cep', 'CEP', f.cep, { max: 9 }) +
                campo('fiscal-municipio', 'Município', f.municipio, { max: 60 }) +
                campo('fiscal-municipio_ibge', 'Código IBGE do município', f.municipio_ibge, { dica: '7 números (São Paulo: 3550308).', max: 7 }) +
                campo('fiscal-uf', 'UF', f.uf || '', { opcoes: ufs }) +
                campo('fiscal-telefone', 'Telefone', f.telefone, { max: 20 }) +
                '<div class="campo"><span class="rotulo-campo">Ambiente da nota</span><p>' + escapar(rotuloDe('ambientes', f.ambiente)) +
                    '<br><small class="dica">Fica em homologação até a etapa de emissão existir.</small></p></div>' +
                '<div class="campo-total"><button type="submit" class="botao">Salvar dados fiscais</button></div>' +
            '</form></div>' +
            '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-5)"></span>Histórico</h3>' +
            (dados.historico.length
                ? tabelaHtml({
                    colunas: ['Quando', 'Campo', 'Antes', 'Depois', 'Quem'],
                    linhas: dados.historico.map(function (h) {
                        return [dataCurta(h.momento) + ' ' + escapar(horaCurta(h.momento)), escapar(h.campo),
                                escapar(h.antes === null ? '—' : h.antes), escapar(h.depois === null ? '—' : h.depois), escapar(h.usuario || '—')];
                    }),
                })
                : vazio('Nada foi mudado ainda.')) + '</div>';
    }

    function desenharCfops() {
        const termo = buscaCfop.trim().toLowerCase().replace(/\./g, '');
        const lista = dados.cfops.filter(function (c) {
            return !termo || (c.codigo + ' ' + c.descricao).toLowerCase().includes(termo);
        });
        const efeito = function (c, nome, dominio) {
            return '<select data-cfop="' + c.codigo + '" data-campo-cfop="' + nome + '" aria-label="' +
                (nome === 'movimenta_estoque' ? 'Estoque' : 'Financeiro') + ' do CFOP ' + fmtCfop(c.codigo) + '">' +
                opcoesDoDominio(dominio).filter(function (o) {
                    return !(c.sentido === 'entrada' && o.valor === 'sai') && !(c.sentido === 'saida' && o.valor === 'entra');
                }).map(function (o) {
                    return '<option value="' + o.valor + '"' + ((c[nome] || 'nao') === o.valor ? ' selected' : '') + '>' + escapar(o.rotulo) + '</option>';
                }).join('') + '</select>';
        };
        return '<div class="table-section">' +
            '<h3 class="table-title"><span style="background:var(--serie-1)"></span>CFOP</h3>' +
            '<p class="secao-descricao">1, 2 e 3 = entrada (no estado, de outro estado, do exterior); 5, 6 e 7 = saída. ' +
                'A tabela traz os mais usados por loja de celulares; o que faltar, cadastre abaixo com a descrição da tabela oficial ' +
                '(Convênio s/nº de 1970). "Permitido" desmarcado impede o uso no pedido.</p>' +
            '<div class="barra-filtros"><input type="search" id="buscaCfop" placeholder="Buscar CFOP ou descrição..." value="' + escapar(buscaCfop) + '"></div>' +
            '<div class="rolagem-x"><table class="tabela-cfop"><thead><tr><th>CFOP</th><th>Descrição</th><th>Permitido</th><th>Estoque</th>' +
                '<th>Financeiro</th><th>Observação da loja</th></tr></thead><tbody>' +
            (lista.length ? lista.map(function (c) {
                return '<tr' + (c.permitido ? '' : ' class="cfop-bloqueado"') + '>' +
                    '<td><strong>' + fmtCfop(c.codigo) + '</strong><br><small class="observacao">' + escapar(c.sentido) + ' ' + escapar(c.alcance) + '</small></td>' +
                    '<td>' + escapar(c.descricao) + (c.oficial ? '' : ' ' + etiquetaTexto('cadastrado pela loja', '--atencao')) +
                        (Number(c.configurado) ? '' : '<br><small class="observacao">padrão: o efeito da natureza que usa este CFOP</small>') + '</td>' +
                    '<td><input type="checkbox" data-cfop="' + c.codigo + '" data-campo-cfop="permitido"' + (c.permitido ? ' checked' : '') +
                        ' aria-label="CFOP ' + fmtCfop(c.codigo) + ' permitido"></td>' +
                    '<td>' + efeito(c, 'movimenta_estoque', 'efeitos_estoque') + '</td>' +
                    '<td>' + efeito(c, 'gera_financeiro', 'efeitos_financeiro') + '</td>' +
                    '<td><input type="text" maxlength="200" data-cfop="' + c.codigo + '" data-campo-cfop="observacao" value="' + escapar(c.observacao || '') +
                        '" aria-label="Observação do CFOP ' + fmtCfop(c.codigo) + '"></td>' +
                    '</tr>';
            }).join('') : '<tr class="empty-row"><td colspan="6">Nenhum CFOP com "' + escapar(buscaCfop) + '".</td></tr>') +
            '</tbody></table></div>' +
            '<h4 class="sub-titulo">Cadastrar CFOP que falta</h4>' +
            '<form id="formCfop" class="formulario fiscal-cfop-novo">' +
                '<div class="campo"><label for="cfopNovoCodigo">Código</label><input type="text" id="cfopNovoCodigo" maxlength="5" placeholder="1.117"></div>' +
                '<div class="campo campo-total"><label for="cfopNovoDescricao">Descrição (como na tabela oficial)</label>' +
                    '<input type="text" id="cfopNovoDescricao" maxlength="300"></div>' +
                '<div><button type="submit" class="botao">Cadastrar CFOP</button></div>' +
            '</form></div>';
    }

    function desenharNaturezas() {
        return '<div class="table-section">' +
            '<h3 class="table-title"><span style="background:var(--serie-2)"></span>Naturezas de operação' +
                '<button type="button" class="botao botao-pequeno" data-fiscal="nova-natureza">+ Nova natureza</button></h3>' +
            '<p class="secao-descricao">O pedido de entrada escolhe a natureza; o CFOP sai dela pela UF do fornecedor e a da loja. ' +
                'As desligadas ficam para as próximas etapas (devolução, venda com nota).</p>' +
            tabelaHtml({
                colunas: ['Natureza', 'Sentido', 'CFOP no estado', 'CFOP de fora', 'Estoque', 'Financeiro', 'Situação', { titulo: 'Ações', classe: 'coluna-acoes' }],
                linhas: dados.naturezas.map(function (n) {
                    return [escapar(n.descricao) + '<br><code class="regra-chave">' + escapar(n.codigo) + '</code>',
                            escapar(rotuloDe('sentidos', n.sentido)) + (n.finalidade !== 'normal' ? '<br><small class="observacao">' + escapar(rotuloDe('finalidades', n.finalidade)) + '</small>' : ''),
                            fmtCfop(n.cfop_interno), fmtCfop(n.cfop_interestadual),
                            escapar(rotuloDe('efeitos_estoque', n.movimenta_estoque)), escapar(rotuloDe('efeitos_financeiro', n.gera_financeiro)),
                            n.ativa ? etiquetaTexto('Ligada', '--bom') : etiquetaTexto('Desligada', '--tinta-fraca'),
                            { classe: 'coluna-acoes', html: '<button type="button" class="botao-icone" data-fiscal="editar-natureza" data-id="' + n.id + '">Editar</button>' }];
                }),
            }) + '</div>';
    }

    function formularioNatureza(n) {
        n = n || { sentido: 'entrada', finalidade: 'normal', movimenta_estoque: 'entra', gera_financeiro: 'pagar', exige_fornecedor: 1, ativa: 1 };
        const opcoesCfop = function (digito) {
            return [{ valor: '', rotulo: '— nenhum —' }].concat(dados.cfops.filter(function (c) { return c.codigo.charAt(0) === digito; })
                .map(function (c) { return { valor: c.codigo, rotulo: fmtCfop(c.codigo) + ' - ' + c.descricao }; }));
        };
        const entrada = n.sentido !== 'saida';
        return [
            { nome: 'codigo', rotulo: 'Código', valor: n.codigo, obrigatorio: true, dica: 'Curto, sem espaço: COMPRA_REVENDA.' },
            { nome: 'descricao', rotulo: 'Descrição', valor: n.descricao, obrigatorio: true, dica: 'É o texto que vai na nota (natureza da operação).' },
            { nome: 'sentido', rotulo: 'Sentido', tipo: 'select', valor: n.sentido, opcoes: opcoesDoDominio('sentidos') },
            { nome: 'finalidade', rotulo: 'Finalidade', tipo: 'select', valor: n.finalidade, opcoes: opcoesDoDominio('finalidades') },
            { nome: 'cfop_interno', rotulo: 'CFOP dentro do estado', tipo: 'select', valor: n.cfop_interno || '', opcoes: opcoesCfop(entrada ? '1' : '5'), largura: 'total' },
            { nome: 'cfop_interestadual', rotulo: 'CFOP de/para outro estado', tipo: 'select', valor: n.cfop_interestadual || '', opcoes: opcoesCfop(entrada ? '2' : '6'), largura: 'total' },
            { nome: 'movimenta_estoque', rotulo: 'Estoque', tipo: 'select', valor: n.movimenta_estoque, opcoes: opcoesDoDominio('efeitos_estoque') },
            { nome: 'gera_financeiro', rotulo: 'Financeiro', tipo: 'select', valor: n.gera_financeiro, opcoes: opcoesDoDominio('efeitos_financeiro') },
            { nome: 'exige_fornecedor', rotulo: 'Exige fornecedor', tipo: 'checkbox', valor: !!Number(n.exige_fornecedor) },
            { nome: 'ativa', rotulo: 'Ligada', tipo: 'checkbox', valor: !!Number(n.ativa) },
        ];
    }

    function desenhar() {
        raiz.innerHTML =
            '<div class="sub-abas" role="tablist" aria-label="Partes do Fiscal">' +
                [['empresa', 'Empresa'], ['cfop', 'CFOP'], ['naturezas', 'Naturezas de operação']].map(function (a) {
                    return '<button type="button" role="tab" aria-selected="' + (a[0] === aba) + '" class="sub-aba' + (a[0] === aba ? ' ativa' : '') +
                        '" data-aba-fiscal="' + a[0] + '">' + a[1] + '</button>';
                }).join('') +
            '</div><div class="admin-painel">' +
            (aba === 'empresa' ? desenharEmpresa() : aba === 'cfop' ? desenharCfops() : desenharNaturezas()) + '</div>';
    }

    async function carregarFiscal() {
        const r = await Promise.all([api.get('/fiscal'), api.get('/cfops'), api.get('/naturezas')]);
        dados = { fiscal: r[0].fiscal, empresa: r[0].empresa, historico: r[0].historico, cfops: r[1].itens, naturezas: r[2].itens };
        desenhar();
        if (aba === 'cfop') {
            const b = document.getElementById('buscaCfop');
            if (b && buscaCfop) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
        }
    }

    async function gravarCfop(campoEl) {
        const corpo = {};
        corpo[campoEl.dataset.campoCfop] = campoEl.type === 'checkbox' ? campoEl.checked : campoEl.value;
        try {
            avisar(mensagemDe(await api.put('/cfops/' + campoEl.dataset.cfop, corpo), 'CFOP gravado.'));
        } catch (erro) {
            avisar(erro.message, 'erro');
        }
        await carregarFiscal();
    }

    raiz.addEventListener('click', function (evento) {
        const botaoAba = evento.target.closest('[data-aba-fiscal]');
        if (botaoAba) { aba = botaoAba.dataset.abaFiscal; desenhar(); return; }
        const acao = evento.target.closest('[data-fiscal]');
        if (!acao) return;
        const n = acao.dataset.fiscal === 'editar-natureza'
            ? dados.naturezas.find(function (x) { return x.id === Number(acao.dataset.id); }) : null;
        abrirModal({
            titulo: n ? 'Natureza: ' + n.descricao : 'Nova natureza de operação',
            campos: formularioNatureza(n),
            aoSalvar: async function (valores) {
                const r = n ? await api.put('/naturezas/' + n.id, valores) : await api.post('/naturezas', valores);
                avisar(mensagemDe(r, 'Natureza gravada.'));
                await carregarFiscal();
            },
        });
    });

    raiz.addEventListener('change', function (evento) {
        if (evento.target.matches('[data-campo-cfop]')) gravarCfop(evento.target);
    });

    raiz.addEventListener('input', function (evento) {
        if (evento.target.id === 'buscaCfop') {
            buscaCfop = evento.target.value;
            desenhar();
            const b = document.getElementById('buscaCfop');
            b.focus();
            b.setSelectionRange(b.value.length, b.value.length);
        }
    });

    raiz.addEventListener('submit', async function (evento) {
        evento.preventDefault();
        try {
            if (evento.target.id === 'formFiscal') {
                const corpo = {};
                Array.from(evento.target.elements).forEach(function (el) { if (el.name) corpo[el.name] = el.value; });
                avisar(mensagemDe(await api.put('/fiscal/' + dados.empresa.id, corpo), 'Dados fiscais gravados.'));
            } else if (evento.target.id === 'formCfop') {
                const r = await api.post('/cfops', { codigo: document.getElementById('cfopNovoCodigo').value,
                                                     descricao: document.getElementById('cfopNovoDescricao').value });
                avisar(mensagemDe(r, 'CFOP cadastrado.'));
            }
        } catch (erro) {
            avisar(erro.message, 'erro');
            return;
        }
        await carregarFiscal();
    });

    N.registrarTela('fiscal', { titulo: 'Fiscal', carregar: carregarFiscal, soAdmin: true });
    janela.Telas = janela.Telas || {};
    janela.Telas.fiscal = { carregar: carregarFiscal };
})(window);
