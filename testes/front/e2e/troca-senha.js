// troca-senha.js - troca obrigatoria de senha sem fuga (roda PRIMEIRO: poe a senha do admin).
// O admin do banco novo entra com a senha inicial; o servidor exige a troca.
'use strict';
const H = require('./lib');
const { L, confere } = H;

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'troca');
    await H.entrar(p, 'admin', H.SENHA_INICIAL);

    const aberta = function () { return p.evaluate(function () { return !document.getElementById('trocaSenha').classList.contains('oculta'); }); };

    await H.bloco('A janela abre antes de qualquer tela e nao tem saida', async function () {
        confere('janela "Troque sua senha" aberta', await aberta(), true);
        confere('nenhuma secao desenhada por baixo', await p.evaluate(function () { return document.getElementById('cardsOs').children.length; }), 0);
        confere('regra de senha do servidor escrita na janela',
                (await p.locator('#trocaSenhaDica').innerText()).length > 25, true);
        await p.keyboard.press('Escape');
        await p.mouse.click(5, 5);
        await p.goto(H.BASE + '/Dashboard/dashboard.html#vendas');
        await p.waitForTimeout(900);
        confere('Esc, clique fora e #vendas na barra nao fecham', await aberta(), true);
        confere('sem botao x', await p.locator('#trocaSenha .modal-fechar').count(), 0);
        await H.print(p, 'troca-obrigatoria');
    });

    await H.bloco('Senha fraca: a recusa do servidor aparece na janela', async function () {
        await p.fill('#trocaAtual', H.SENHA_INICIAL);
        await p.fill('#trocaNova', 'senhasenha');
        await p.fill('#trocaConfirma', 'senhasenha');
        await p.click('#formTrocaSenha button[type="submit"]');
        await p.waitForTimeout(900);
        const msg = await p.locator('#trocaSenhaErro').innerText();
        L('  mensagem do servidor: "' + msg + '"');
        confere('recusada e a janela continua', [msg.length > 0, await aberta()], [true, true]);
    });

    await H.bloco('Senha forte: a janela fecha e o painel carrega', async function () {
        await p.fill('#trocaNova', H.SENHA_ADMIN);
        await p.fill('#trocaConfirma', H.SENHA_ADMIN);
        await p.click('#formTrocaSenha button[type="submit"]');
        await p.waitForTimeout(1500);
        // A barra estava em #vendas (tentativa de fuga acima): e essa secao que abre agora.
        confere('fechou e abriu a secao pedida', [await aberta(), await p.locator('#tituloPagina').innerText(),
            (await p.locator('#listaVendas').innerText()).indexOf('Carregando') === -1], [false, 'Vendas', true]);
    });

    H.terminar('troca-senha');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
