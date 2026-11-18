// fumaca.js - passa por todas as secoes, sub-abas e formularios sem erro de JS.
// Confere tambem que os numeros "prontos" vem do servidor (R2 item 8): o painel
// usa resumo.cards/os_em_andamento e o Financeiro nao chama /api/resumo.
'use strict';
const H = require('./lib');
const { L, sql, confere } = H;

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'fumaca');
    const pedidos = [];
    p.on('request', function (r) { if (r.url().indexOf('/api/') !== -1) pedidos.push(r.method() + ' ' + r.url().replace(H.BASE, '')); });
    await H.entrar(p, 'admin', H.SENHA_ADMIN);

    async function abrirEFechar(seletor, rotulo) {
        const alvo = p.locator(seletor).first();
        if (!(await alvo.count())) { L('  (sem ' + rotulo + ' para abrir)'); return; }
        await alvo.click(); await p.waitForTimeout(700);
        const aberto = await H.modalAberto(p);
        L('  ' + rotulo + ': ' + (aberto ? 'abriu' : 'NAO abriu'));
        if (aberto) {
            if (await p.locator('#modalCancelar').isVisible()) await p.click('#modalCancelar');
            else await p.keyboard.press('Escape');
            await p.waitForTimeout(300);
        }
    }

    await H.bloco('Painel: cards e "OS em andamento" vem do /api/resumo', async function () {
        await H.secao(p, 'dashboard');
        const resumo = await H.apiNa(p, 'GET', '/resumo');
        const cartao = function (id) { return p.locator('#' + id).innerText(); };
        const fmt = function (v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0); };
        confere('card Stock Ready = resumo.cards.ready.venda', (await cartao('cardReady')).replace(/\s/g, ' '),
                fmt(resumo.cards.ready && resumo.cards.ready.venda).replace(/\s/g, ' '));
        confere('card "OS em andamento" = resumo.os_em_andamento',
                await p.locator('#cardsOs .stat-box').first().locator('.stat-value').innerText(), String(resumo.os_em_andamento));
    });

    await H.bloco('Menu em grupos e a entrada unica (v9)', async function () {
        const grupos = function () {
            return p.evaluate(function () {
                return { abertos: Array.from(document.querySelectorAll('nav .menu-grupo')).filter(function (g) {
                             return !g.querySelector('.submenu').hidden; }).map(function (g) { return g.dataset.grupo; }).join(','),
                         aceso: (document.querySelector('nav .menu-grupo.tem-ativo') || { dataset: {} }).dataset.grupo || '',
                         titulo: document.getElementById('tituloPagina').textContent };
            });
        };
        await H.secao(p, 'inicio');
        confere('no Inicio os grupos ficam fechados', (await grupos()).abertos, '');
        await H.secao(p, 'fiscal');
        confere('Administrativo > Fiscal abre so o grupo dele', await grupos(), { abertos: 'administrativo', aceso: 'administrativo', titulo: 'Fiscal' });
        await H.secao(p, 'entradas');
        confere('Compras e estoque > Estoque', await grupos(), { abertos: 'estoque', aceso: 'estoque', titulo: 'Estoque' });
        confere('o Estoque nao lanca entrada avulsa', await p.locator('[data-acao="nova-entrada"]').count(), 0);
        await p.click('[data-acao="estoque-nova-entrada"]'); await p.waitForTimeout(1300);
        confere('"+ Nova entrada" abre a tela Entradas com uma linha e o "Ja paguei"', await p.evaluate(function () {
            return [location.hash, document.getElementById('tituloPagina').textContent,
                    document.querySelector('#secao-pedidos .secao-titulo').textContent.indexOf('Nova entrada') === 0,
                    document.querySelectorAll('#secao-pedidos .pedido-linha').length, !!document.getElementById('pedidoPago')];
        }), ['#pedidos', 'Entradas', true, 1, true]);
        await H.print(p, 'entrada-nova');
    });

    await H.bloco('Todas as secoes e formularios abrem', async function () {
        await H.secao(p, 'entradas');
        await abrirEFechar('[data-acao="editar-entrada"]', 'editar entrada');
        await abrirEFechar('[data-acao="ficha-entrada"]', 'ficha da entrada');
        await H.secao(p, 'os');
        await abrirEFechar('[data-acao="nova-os"]', 'nova OS');
        await abrirEFechar('[data-acao="editar-os"]', 'editar OS');
        await abrirEFechar('[data-acao="historico-os"]', 'historico da OS');
        await abrirEFechar('[data-acao="movimentar-os"]', 'garantia da OS');
        await H.secao(p, 'vendas');
        await abrirEFechar('[data-acao="ver-venda"]', 'ver venda');
        await abrirEFechar('[data-acao="editar-venda"]', 'editar venda');
        // ADAPTADO-v7: a janela "Nova venda" saiu; o botao da tela Vendas abre o PDV.
        confere('Vendas sem a janela antiga', await p.locator('[data-acao="nova-venda"]').count(), 0);
        await p.click('[data-acao="abrir-pdv"]'); await p.waitForTimeout(1200);
        confere('"Abrir o PDV" abre o PDV em tela cheia', await p.evaluate(function () {
            return [location.hash, document.body.classList.contains('tela-cheia')];
        }), ['#pdv', true]);
        await p.click('[data-pdv="sair"]'); await p.waitForTimeout(800);
        await H.secao(p, 'cadastros');
        for (const c of ['clientes', 'modelos', 'pecas', 'produtos', 'servicos', 'fornecedores', 'formas']) {
            await p.click('#subAbasCadastros [data-cadastro="' + c + '"]'); await p.waitForTimeout(300);
            await abrirEFechar('#botaoNovoCadastro', 'novo ' + c);
            await abrirEFechar('[data-acao="editar-cadastro"]', 'editar ' + c);
        }
        await abrirEFechar('[data-acao="nova-movimentacao"]', 'movimentar estoque');
        await H.secao(p, 'financeiro');
        const antes = pedidos.length;
        await p.click('#subAbasFinanceiro [data-painel="resumo"]'); await p.waitForTimeout(800);
        confere('Resumo do Financeiro sem GET /api/resumo extra',
                pedidos.slice(antes).filter(function (r) { return /\/api\/resumo/.test(r); }).length, 0);
        await p.click('#subAbasFinanceiro [data-painel="lancamentos"]'); await p.waitForTimeout(800);
        await p.selectOption('#filtroLancStatus', ''); await p.waitForTimeout(600);
        await abrirEFechar('[data-acao="novo-lancamento"][data-tipo="receber"]', 'novo lancamento');
        await abrirEFechar('[data-acao="editar-lancamento"]', 'editar lancamento');
        await abrirEFechar('[data-acao="log-lancamento"]', 'log do lancamento');
        await p.click('#subAbasFinanceiro [data-painel="vendas"]'); await p.waitForTimeout(800);
        await p.selectOption('#histOrigem', 'os'); await p.waitForTimeout(400);
        await H.secao(p, 'configuracoes');
        await abrirEFechar('[data-acao="novo-usuario"]', 'novo usuario');
        await abrirEFechar('[data-acao="editar-usuario"]', 'editar usuario');
        confere('regra de senha em Configuracoes', (await p.locator('#regraSenhaConta').innerText()).length > 25, true);
        await H.print(p, 'fumaca-configuracoes');
    });

    await H.bloco('Lancamento: o servidor decide editar valor e excluir', async function () {
        await H.secao(p, 'financeiro');
        await p.click('#subAbasFinanceiro [data-painel="lancamentos"]'); await p.waitForTimeout(800);
        await p.selectOption('#filtroLancStatus', ''); await p.waitForTimeout(600);
        const l = sql("select id from lancamentos where origem='venda' order by id limit 1")[0];
        confere('lancamento de venda sem Excluir', await p.locator('[data-acao="excluir-lancamento"][data-id="' + l.id + '"]').count(), 0);
        await p.click('[data-acao="editar-lancamento"][data-id="' + l.id + '"]'); await p.waitForTimeout(500);
        confere('valor somente leitura', await p.evaluate(function () { return document.getElementById('campo-valor').readOnly; }), true);
        await p.click('#modalCancelar');
    });

    await H.bloco('Sem /api/config o painel nao abre pela metade: aviso com "Tentar de novo"', async function () {
        const ctx2 = await H.novoContexto(navegador);
        const q = await H.novaPagina(ctx2, 'semConfig');
        let falhar = true;
        await ctx2.route('**/api/config', function (r) {
            if (!falhar) return r.continue();
            return r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"erro":"Erro interno."}' });
        });
        await H.entrar(q, 'admin', H.SENHA_ADMIN);
        // ADAPTADO-v6: depois do login a primeira tela e o Inicio (#inicioConteudo), nao mais o Dashboard.
        confere('aviso visivel e nada desenhado', [await q.locator('.falha-config').isVisible(),
            await q.evaluate(function () { return document.getElementById('inicioConteudo').children.length; })], [true, 0]);
        await H.print(q, 'config-falhou');
        falhar = false;
        await q.click('.falha-config button'); await q.waitForTimeout(1500);
        confere('"Tentar de novo" abre o painel', [await q.locator('.falha-config').count(),
            await q.evaluate(function () { return document.getElementById('inicioConteudo').children.length > 0; })], [0, true]);
        await ctx2.close();
    });

    H.terminar('fumaca');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
