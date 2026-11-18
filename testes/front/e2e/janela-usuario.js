// janela-usuario.js - a sessao passou a ser de OUTRO usuario (entrou com outro login
// noutra aba) com a janela aberta: nada e gravado em nome errado (banca R3, item 3).
'use strict';
const H = require('./lib');
const { L, sql, confere } = H;

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const a = await H.novaPagina(ctx, 'abaA');
    await H.entrar(a, 'admin', H.SENHA_ADMIN);

    const login = 'outro' + String(Date.now()).slice(-5);
    const senha = 'Provisoria-' + String(Date.now()).slice(-6) + 'q';
    const u = await H.apiNa(a, 'POST', '/usuarios', { usuario: login, nome: 'Outro E2E', perfil: 'tecnico', senha: senha, ativo: 1 });
    L('massa: usuario ' + login + ' (' + u.status + ')');

    await H.bloco('Outro login noutra aba: o Salvar nao grava e explica', async function () {
        await H.secao(a, 'os');
        await a.click('[data-acao="nova-os"]'); await a.waitForTimeout(500);
        await a.selectOption('#campo-cliente_id', { index: 1 });
        await a.selectOption('#campo-modelo_id', { index: 1 });
        await a.fill('#campo-defeito_relatado', 'digitado pelo admin antes da troca');

        const b = await H.novaPagina(ctx, 'abaB');
        await b.goto(H.BASE + '/Dashboard/dashboard.html'); await b.waitForTimeout(900);
        await b.click('#botaoSair'); await b.waitForURL(/Login/);
        await H.entrar(b, login, senha);
        await b.close();

        const antes = sql('select count(*) n from ordens_servico')[0].n;
        await H.salvar(a);
        const msg = await H.erroDaJanela(a);
        L('  aviso: "' + msg + '"');
        confere('aviso cita o outro usuario e nao grava', [/Você entrou como Outro E2E/.test(msg || ''),
            sql('select count(*) n from ordens_servico')[0].n, await H.modalAberto(a)], [true, antes, true]);
        confere('botoes do aviso', await a.evaluate(function () {
            return Array.from(document.querySelectorAll('.modal-erro-acoes button')).map(function (x) { return x.textContent; });
        }), ['Copiar o que digitei', 'Recarregar']);
        await H.print(a, 'janela-outro-usuario');
        await a.click('.modal-erro-acoes button:has-text("Copiar")'); await a.waitForTimeout(300);
        confere('o digitado foi para o aviso', (await a.inputValue('.modal-erro .copia-digitado')).includes('digitado pelo admin'), true);

        a.dialogos = [];
        await a.click('.modal-erro-acoes button:has-text("Recarregar")');
        await a.waitForTimeout(2000);
        confere('recarregou sem perguntar e o canto mostra o usuario da sessao', [a.dialogos.length,
            await a.locator('#usuarioNome').innerText()], [0, 'Outro E2E']);
    });

    H.terminar('janela-usuario');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
