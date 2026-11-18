// bloqueio.js - login errado avisa "Restam N tentativa(s)", bloqueia, e o admin destrava
// pela tela de Usuarios (R2 item 1). Roda por ULTIMO: deixa um usuario de teste bloqueado e liberado.
'use strict';
const H = require('./lib');
const { L, confere } = H;

(async function () {
    const navegador = await H.chromium.launch();
    const ctxAdmin = await H.novoContexto(navegador);
    const adm = await H.novaPagina(ctxAdmin, 'admin');
    await H.entrar(adm, 'admin', H.SENHA_ADMIN);

    const login = 'travado' + String(Date.now()).slice(-5);
    const senha = 'Senha-Certa-' + String(Date.now()).slice(-6);
    await H.apiNa(adm, 'POST', '/usuarios', { usuario: login, nome: 'Travado E2E', perfil: 'tecnico', senha: senha, ativo: 1 });

    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'login');
    const mensagens = [];

    await H.bloco('Erros seguidos: o Login avisa quantas tentativas restam e depois bloqueia', async function () {
        await p.goto(H.BASE + '/Login/index.html');
        for (let i = 0; i < 8; i++) {
            await p.fill('#username', login);
            await p.fill('#password', 'errada' + i);
            await p.click('#loginForm button'); await p.waitForTimeout(700);
            mensagens.push(await p.locator('#errorMessage').innerText());
            if (/Muitas tentativas/.test(mensagens[mensagens.length - 1])) break;
        }
        mensagens.forEach(function (m, i) { L('  tentativa ' + (i + 1) + ': ' + m); });
        confere('alguma mensagem diz "Restam N tentativa(s)"', mensagens.some(function (m) { return /Restam \d+ tentativa/.test(m); }), true);
        confere('termina em bloqueio', /Muitas tentativas/.test(mensagens[mensagens.length - 1]), true);
        await H.print(p, 'login-restam');
        // A senha certa tambem nao entra enquanto esta bloqueado.
        await p.fill('#username', login); await p.fill('#password', senha);
        await p.click('#loginForm button'); await p.waitForTimeout(700);
        confere('senha certa bloqueada', /Muitas tentativas/.test(await p.locator('#errorMessage').innerText()), true);
    });

    await H.bloco('O dono continua entrando (o bloqueio e do login que errou)', async function () {
        const ctx2 = await H.novoContexto(navegador);
        const d = await H.novaPagina(ctx2, 'dono');
        await H.entrar(d, 'admin', H.SENHA_ADMIN);
        confere('admin entrou', /dashboard/.test(d.url()), true);
        await ctx2.close();
    });

    await H.bloco('Admin ve "Bloqueado ate HH:MM" e destrava', async function () {
        await H.secao(adm, 'configuracoes');
        const linha = adm.locator('#listaUsuarios tr', { hasText: login });
        const texto = await linha.innerText();
        L('  linha do usuario: ' + texto.replace(/\s+/g, ' '));
        confere('mostra "Bloqueado até"', /Bloqueado até/.test(texto), true);
        await H.print(adm, 'usuarios-bloqueado');
        await linha.locator('[data-acao="destravar-usuario"]').click(); await adm.waitForTimeout(1200);
        confere('depois de destravar some o aviso', /Bloqueado até/.test(await adm.locator('#listaUsuarios tr', { hasText: login }).innerText()), false);
        await H.entrar(p, login, senha);
        confere('o usuario entra de novo', /dashboard/.test(p.url()), true);
    });

    H.terminar('bloqueio');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
