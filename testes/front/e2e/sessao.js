// sessao.js - nao perder o formulario: 409 entre abas, sessao encerrada com login
// dentro da janela, F5 (beforeunload) e Voltar do navegador.
'use strict';
const H = require('./lib');
const { L, sql, confere } = H;

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const a = await H.novaPagina(ctx, 'abaA');
    await H.entrar(a, 'admin', H.SENHA_ADMIN);

    await H.bloco('409: outra aba gravou a OS; o digitado fica e ha "Recarregar" e "Copiar"', async function () {
        await H.secao(a, 'os');
        await a.click('[data-acao="nova-os"]'); await a.waitForTimeout(500);
        await a.selectOption('#campo-cliente_id', { index: 1 });
        await a.selectOption('#campo-modelo_id', { index: 1 });
        await a.fill('#campo-defeito_relatado', 'e2e conflito original');
        await H.salvar(a);
        const id = sql('select max(id) id from ordens_servico')[0].id;

        await a.click('[data-acao="editar-os"][data-id="' + id + '"]'); await a.waitForTimeout(800);
        const b = await H.novaPagina(ctx, 'abaB');
        await b.goto(H.BASE + '/Dashboard/dashboard.html#os'); await b.waitForTimeout(1000);
        await b.click('[data-acao="editar-os"][data-id="' + id + '"]'); await b.waitForTimeout(800);
        await b.fill('#campo-diagnostico', 'gravado pela aba B');
        await H.salvar(b);
        await b.close();

        await a.fill('#campo-defeito_relatado', 'digitado na aba A depois');
        await a.selectOption('#campo-status', 'orcamento');
        await a.evaluate(function () { window.__avisos = []; });
        await H.salvar(a);
        const msg = await H.erroDaJanela(a);
        L('  mensagem na janela: "' + msg + '"');
        confere('janela aberta, texto digitado mantido', [await H.modalAberto(a), await a.inputValue('#campo-defeito_relatado')],
                [true, 'digitado na aba A depois']);
        confere('botoes do conflito', await a.evaluate(function () {
            return Array.from(document.querySelectorAll('.modal-erro-acoes button')).map(function (b) { return b.textContent; });
        }), ['Recarregar (perde o que digitei)', 'Copiar o que digitei']);
        confere('sem toast repetindo o erro por cima do Salvar', await a.evaluate(function () { return window.__avisos.length; }), 0);
        confere('banco ficou com o da aba B', sql('select diagnostico d, defeito_relatado r from ordens_servico where id=' + id)[0],
                { d: 'gravado pela aba B', r: 'e2e conflito original' });
        await H.print(a, '409-conflito');

        await a.click('.modal-erro-acoes button:has-text("Copiar")'); await a.waitForTimeout(300);
        const copiado = await a.inputValue('.modal-erro .copia-digitado');
        L('  copiado: ' + JSON.stringify(copiado));
        confere('"Copiar" leva o texto digitado e o status escolhido pelo nome, sem os campos nao mexidos',
                [copiado.includes('digitado na aba A depois'), /Status: Orçamento/.test(copiado),
                 /Orçamento \(R\$\)|Mão de obra|Valor final/.test(copiado)], [true, true, false]);
        await a.click('.modal-erro-acoes button:has-text("Recarregar")'); await a.waitForTimeout(1200);
        confere('"Recarregar" abre de novo com o gravado agora',
                [await H.modalAberto(a), await a.inputValue('#campo-diagnostico')], [true, 'gravado pela aba B']);
        await a.click('#modalCancelar');
    });

    await H.bloco('Sessao encerrada: login dentro da janela, sem sair da tela', async function () {
        await H.secao(a, 'os');
        await a.click('[data-acao="nova-os"]'); await a.waitForTimeout(500);
        await a.selectOption('#campo-cliente_id', { index: 1 });
        await a.selectOption('#campo-modelo_id', { index: 1 });
        await a.fill('#campo-defeito_relatado', 'digitado antes de a sessao cair');
        const b = await H.novaPagina(ctx, 'abaSair');
        await b.goto(H.BASE + '/Dashboard/dashboard.html'); await b.waitForTimeout(900);
        await b.click('#botaoSair'); await b.waitForURL(/Login/);
        await b.close();

        const antes = sql('select count(*) n from ordens_servico')[0].n;
        await H.salvar(a);
        confere('continua no painel com o texto', [/dashboard\.html/.test(a.url()), await a.inputValue('#campo-defeito_relatado')],
                [true, 'digitado antes de a sessao cair']);
        confere('formulario de login dentro do aviso', await a.locator('.login-na-janela [data-login-senha]').count(), 1);
        confere('o usuario vem travado no da sessao anterior', await a.evaluate(function () {
            const u = document.querySelector('.login-na-janela [data-login-usuario]');
            return [u.readOnly, u.value];
        }), [true, 'admin']);
        await H.print(a, 'sessao-login-na-janela');
        await a.fill('.login-na-janela [data-login-senha]', H.SENHA_ADMIN);
        await a.click('.login-na-janela [data-login-entrar]'); await a.waitForTimeout(1200);
        L('  aviso depois de entrar: "' + await a.locator('.modal-erro').innerText() + '"');
        await H.salvar(a);
        confere('Salvar depois do login grava a OS', [sql('select count(*) n from ordens_servico')[0].n, await H.modalAberto(a)],
                [antes + 1, false]);
    });

    await H.bloco('Voltar do navegador navega entre secoes e nao fecha formulario alterado', async function () {
        await H.secao(a, 'entradas');
        await H.secao(a, 'vendas');
        await a.goBack(); await a.waitForTimeout(800);
        confere('Voltar de Vendas leva a Entradas', /#entradas$/.test(a.url()), true);
        await H.secao(a, 'os');
        await a.click('[data-acao="nova-os"]'); await a.waitForTimeout(500);
        await a.fill('#campo-defeito_relatado', 'digitado antes do Voltar');
        await a.goBack(); await a.waitForTimeout(800);
        confere('janela e texto continuam, secao continua #os',
                [await H.modalAberto(a), await a.inputValue('#campo-defeito_relatado'), /#os$/.test(a.url())],
                [true, 'digitado antes do Voltar', true]);
    });

    await H.bloco('F5 com formulario alterado: o navegador pergunta', async function () {
        const dialogo = a.waitForEvent('dialog', { timeout: 4000 }).catch(function () { return null; });
        a.reload().catch(function () {});
        const d = await dialogo;
        confere('dialogo antes de recarregar', d ? d.type() : 'nenhum', 'beforeunload');
        await a.waitForTimeout(1000);
    });

    H.terminar('sessao');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
