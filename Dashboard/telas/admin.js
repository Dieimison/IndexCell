// carga: usa Formato, Nucleo; publica Telas.admin  (conferido por testes/front/carga.test.js)
/*
 * telas/admin.js - Admin: regras da loja, dados da empresa e listas.
 * Window.Telas.admin. So o administrador ve (o servidor recusa os outros).
 *
 *   Regras   cada chave com tres niveis: o padrao do sistema, o GERAL
 *            (chaves_geral) e o DESTA EMPRESA (chaves_empresa). Vale o da
 *            empresa, se houver; senao o geral; senao o padrao. "Herdar"
 *            apaga o valor daquele nivel. Toda mudanca entra no historico.
 *   Empresa  nome, razao social e CNPJ (o servidor confere os digitos).
 *   Listas   marcas, cores, armazenamentos, categorias: tirar da lista ou
 *            devolver. Tirar nao muda o que ja foi gravado.
 */
(function (janela) {
    'use strict';

    const { escapar, dataCurta, horaCurta } = janela.Formato;
    const N = janela.Nucleo;
    const { api, estado, avisar, mensagemDe, rotuloDe, dominio, etiquetaTexto, tabelaHtml, vazio } = N;

    const raiz = document.getElementById('adminConteudo');
    let aba = 'regras';
    let dados = { chaves: [], historico: [], empresa: null, listas: {} };

    const ORIGEM = { empresa: ['desta empresa', '--serie-3'], geral: ['geral', '--serie-1'], padrao: ['padrão do sistema', '--tinta-fraca'] };

    function textoValor(chave, valor) {
        if (valor === null || valor === undefined) return '—';
        if (chave.tipo === 'liga') return valor === '1' ? 'Ligado' : 'Desligado';
        return String(valor) + (/\(%\)$/.test(chave.rotulo) ? '%' : '');
    }

    /* Controle de um nivel: liga = select herdar/ligado/desligado; numero = campo. */
    function controle(chave, escopo) {
        const atual = chave[escopo];
        const id = 'chave-' + escopo + '-' + chave.chave.replace(/\W/g, '-');
        const rotulo = escopo === 'geral' ? 'Geral' : 'Desta empresa';
        if (chave.tipo === 'liga') {
            return '<label class="oculto-visual" for="' + id + '">' + rotulo + ': ' + escapar(chave.rotulo) + '</label>' +
                '<select id="' + id + '" data-chave="' + escapar(chave.chave) + '" data-escopo="' + escopo + '">' +
                    '<option value=""' + (atual === null ? ' selected' : '') + '>Herdar</option>' +
                    '<option value="1"' + (atual === '1' ? ' selected' : '') + '>Ligado</option>' +
                    '<option value="0"' + (atual === '0' ? ' selected' : '') + '>Desligado</option>' +
                '</select>';
        }
        return '<label class="oculto-visual" for="' + id + '">' + rotulo + ': ' + escapar(chave.rotulo) + '</label>' +
            '<input type="number" id="' + id + '" min="' + chave.min + '" max="' + chave.max + '" step="1" placeholder="herdar" value="' +
                (atual === null ? '' : escapar(atual)) + '" data-chave="' + escapar(chave.chave) + '" data-escopo="' + escopo + '">';
    }

    function desenharRegras() {
        const grupos = {};
        dados.chaves.forEach(function (c) { (grupos[c.grupo] = grupos[c.grupo] || []).push(c); });
        const empresa = dados.empresa ? dados.empresa.nome : 'empresa';
        return '<p class="secao-descricao admin-explica">Vale o valor <strong>desta empresa</strong>, se houver; senão o ' +
                '<strong>geral</strong>; senão o padrão do sistema. Deixe em "Herdar" (ou vazio) para usar o nível de baixo. ' +
                'Quem confere é o servidor, em cada venda: esconder um botão não é a regra.</p>' +
            Object.keys(grupos).map(function (g) {
                return '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-1)"></span>' + escapar(g) + '</h3>' +
                    '<div class="rolagem-x"><table class="tabela-regras"><thead><tr>' +
                        '<th>Regra</th><th>Padrão</th><th>Geral</th><th>' + escapar(empresa) + '</th><th>Vale agora</th>' +
                    '</tr></thead><tbody>' +
                    grupos[g].map(function (c) {
                        const o = ORIGEM[c.origem];
                        return '<tr>' +
                            '<td><strong>' + escapar(c.rotulo) + '</strong><br><small class="observacao">' + escapar(c.ajuda) + '</small>' +
                                '<br><code class="regra-chave">' + escapar(c.chave) + '</code></td>' +
                            '<td>' + escapar(textoValor(c, c.padrao)) + '</td>' +
                            '<td>' + controle(c, 'geral') + '</td>' +
                            '<td>' + controle(c, 'empresa') + '</td>' +
                            '<td><strong>' + escapar(textoValor(c, c.valor)) + '</strong><br>' + etiquetaTexto(o[0], o[1]) + '</td>' +
                            '</tr>';
                    }).join('') +
                    '</tbody></table></div></div>';
            }).join('') +
            '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-5)"></span>Histórico das regras</h3>' +
                (dados.historico.length
                    ? tabelaHtml({
                        colunas: ['Quando', 'Regra', 'Nível', 'Antes', 'Depois', 'Quem'],
                        linhas: dados.historico.map(function (h) {
                            const c = dados.chaves.find(function (x) { return x.chave === h.chave; }) || { tipo: 'numero', rotulo: '' };
                            return [dataCurta(h.momento) + ' ' + escapar(horaCurta(h.momento)), escapar(c.rotulo || h.chave),
                                    escapar(rotuloDe('escopos_chave', h.escopo)),
                                    h.antes === null ? '<small class="observacao">herdava</small>' : escapar(textoValor(c, h.antes)),
                                    h.depois === null ? '<small class="observacao">herda</small>' : escapar(textoValor(c, h.depois)),
                                    escapar(h.usuario || '—')];
                        }),
                    })
                    : vazio('Nenhuma regra foi mudada ainda.')) +
            '</div>';
    }

    function desenharEmpresa() {
        const e = dados.empresa || {};
        const cnpj = e.cnpj ? String(e.cnpj).replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '';
        return '<div class="table-section admin-empresa">' +
            '<h3 class="table-title"><span style="background:var(--serie-3)"></span>Dados da empresa</h3>' +
            '<p class="secao-descricao">Hoje a loja é uma empresa só. Estes dados vão para as regras por empresa e, ' +
                'mais tarde, para o módulo fiscal.</p>' +
            '<form id="formEmpresa" class="formulario">' +
                '<div class="campo"><label for="empresaNome">Nome da loja</label>' +
                    '<input type="text" id="empresaNome" required maxlength="120" value="' + escapar(e.nome || '') + '"></div>' +
                '<div class="campo"><label for="empresaRazao">Razão social</label>' +
                    '<input type="text" id="empresaRazao" maxlength="160" value="' + escapar(e.razao_social || '') + '"></div>' +
                '<div class="campo"><label for="empresaCnpj">CNPJ</label>' +
                    '<input type="text" id="empresaCnpj" maxlength="18" autocapitalize="characters" placeholder="00.000.000/0000-00" value="' +
                        escapar(cnpj) + '"><small class="dica">Os dois últimos números são de conferência: o sistema recusa CNPJ com dígito errado. ' +
                        'CNPJ novo pode ter letras (ex.: 12.ABC.345/01DE-35).</small></div>' +
                '<button type="submit" class="botao">Salvar dados da empresa</button>' +
            '</form></div>';
    }

    function desenharListas() {
        const nomes = dominio('listas');
        return '<p class="secao-descricao admin-explica">Estes são os valores que aparecem para escolher nos cadastros. ' +
                'Para acrescentar, use "+ Nova" no próprio formulário ou o campo abaixo. Tirar um valor da lista não muda ' +
                'os registros que já usam ele.</p>' +
            '<div class="tables-grid">' + nomes.map(function (l) {
                const valores = dados.listas[l.valor] || [];
                return '<div class="table-section"><h3 class="table-title"><span style="background:var(--serie-2)"></span>' + escapar(l.rotulo) + '</h3>' +
                    '<ul class="admin-lista">' + valores.map(function (v) {
                        return '<li class="' + (v.ativo ? '' : 'inativo') + '"><span>' + escapar(v.valor) + '</span>' +
                            '<button type="button" class="botao-icone" data-lista-ativo="' + (v.ativo ? 0 : 1) + '" data-id="' + v.id + '">' +
                                (v.ativo ? 'Tirar da lista' : 'Devolver') + '</button></li>';
                    }).join('') + '</ul>' +
                    '<form class="admin-lista-nova" data-lista="' + l.valor + '">' +
                        '<label class="oculto-visual" for="nova-' + l.valor + '">Novo valor em ' + escapar(l.rotulo) + '</label>' +
                        '<input type="text" id="nova-' + l.valor + '" maxlength="60" placeholder="Novo valor">' +
                        '<button type="submit" class="botao botao-pequeno">Acrescentar</button>' +
                    '</form></div>';
            }).join('') + '</div>';
    }

    function desenhar() {
        raiz.innerHTML =
            '<div class="sub-abas" role="tablist" aria-label="Partes do Admin">' +
                [['regras', 'Regras da loja'], ['empresa', 'Empresa'], ['listas', 'Listas']].map(function (a) {
                    return '<button type="button" role="tab" aria-selected="' + (a[0] === aba) + '" class="sub-aba' + (a[0] === aba ? ' ativa' : '') +
                        '" data-aba-admin="' + a[0] + '">' + a[1] + '</button>';
                }).join('') +
            '</div>' +
            '<div class="admin-painel">' +
                (aba === 'regras' ? desenharRegras() : aba === 'empresa' ? desenharEmpresa() : desenharListas()) +
            '</div>';
    }

    async function carregarAdmin() {
        const [r, listas] = await Promise.all([api.get('/chaves'), api.get('/listas?todas=1')]);
        dados = { chaves: r.chaves, historico: r.historico, empresa: r.empresa, listas: listas.listas };
        desenhar();
    }

    /* Uma regra mudou: grava e atualiza o /config da tela (o PDV le dali). */
    async function gravarRegra(campo) {
        const valor = campo.value.trim();
        try {
            const r = await api.post('/chaves', { chave: campo.dataset.chave, escopo: campo.dataset.escopo, valor: valor === '' ? null : valor });
            avisar(mensagemDe(r, 'Regra gravada.'));
            estado.config = (await api.get('/config')).config;
            if (janela.Ambiente) janela.Ambiente.conferir();   // "banco de teste" liga/desliga a faixa na hora
        } catch (erro) {
            avisar(erro.message, 'erro');
        }
        await carregarAdmin();
    }

    raiz.addEventListener('click', async function (evento) {
        const botaoAba = evento.target.closest('[data-aba-admin]');
        if (botaoAba) { aba = botaoAba.dataset.abaAdmin; desenhar(); return; }
        const ativo = evento.target.closest('[data-lista-ativo]');
        if (ativo) {
            try {
                const r = await api.put('/listas/' + ativo.dataset.id, { ativo: ativo.dataset.listaAtivo === '1' });
                avisar(mensagemDe(r, 'Lista atualizada.'));
                estado.listas = {};   // os formularios recarregam pelo carregarCatalogos
            } catch (erro) {
                avisar(erro.message, 'erro');
            }
            await carregarAdmin();
        }
    });

    raiz.addEventListener('change', function (evento) {
        if (evento.target.matches('[data-chave]')) gravarRegra(evento.target);
    });

    raiz.addEventListener('submit', async function (evento) {
        evento.preventDefault();
        const form = evento.target;
        try {
            if (form.id === 'formEmpresa') {
                const r = await api.put('/empresa/' + dados.empresa.id, {
                    nome: document.getElementById('empresaNome').value,
                    razao_social: document.getElementById('empresaRazao').value,
                    cnpj: document.getElementById('empresaCnpj').value,
                });
                avisar(mensagemDe(r, 'Dados da empresa gravados.'));
                estado.config = (await api.get('/config')).config;
            } else if (form.matches('.admin-lista-nova')) {
                const campo = form.querySelector('input');
                if (!campo.value.trim()) { campo.focus(); return; }
                const r = await api.post('/listas', { lista: form.dataset.lista, valor: campo.value });
                avisar(mensagemDe(r, 'Cadastrado na lista.'));
            }
        } catch (erro) {
            avisar(erro.message, 'erro');
            return;
        }
        await carregarAdmin();
    });

    N.registrarTela('admin', { titulo: 'Empresa e regras', carregar: carregarAdmin, soAdmin: true });
    janela.Telas = janela.Telas || {};
    janela.Telas.admin = { carregar: carregarAdmin };
})(window);
