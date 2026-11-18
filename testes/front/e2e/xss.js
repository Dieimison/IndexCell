// xss.js - texto com aspas gravado pela API nao vira atributo nem executa (banca R1, item 11).
'use strict';
const H = require('./lib');
const { confere } = H;

(async function () {
    const navegador = await H.chromium.launch();
    const ctx = await H.novoContexto(navegador);
    const p = await H.novaPagina(ctx, 'xss');
    await H.entrar(p, 'admin', H.SENHA_ADMIN);

    const nome = 'x" autofocus onfocus="alert(1)';
    const c = await H.apiNa(p, 'POST', '/clientes', { nome: nome, telefone: '(11) 9' + String(Date.now()).slice(-8) });

    await H.bloco('Editar cliente com aspas no nome', async function () {
        await H.secao(p, 'cadastros');
        p.dialogos = [];
        await p.click('[data-acao="editar-cadastro"][data-id="' + c.id + '"]'); await p.waitForTimeout(800);
        await p.focus('#campo-nome'); await p.waitForTimeout(300);
        confere('o campo tem o nome inteiro como texto', await p.inputValue('#campo-nome'), nome);
        confere('nenhum atributo onfocus/autofocus', await p.evaluate(function () {
            return ['onfocus', 'autofocus'].filter(function (a) { return document.getElementById('campo-nome').hasAttribute(a); });
        }), []);
        await p.click('#modalCancelar');
        await H.secao(p, 'os');
        await p.click('[data-acao="nova-os"]'); await p.waitForTimeout(500);
        confere('no select da OS o nome aparece como texto', await p.evaluate(function (a) {
            return document.querySelector('#campo-cliente_id option[value="' + a[0] + '"]').textContent.indexOf(a[1]) === 0;
        }, [String(c.id), nome]), true);
        await p.click('#modalCancelar');
        confere('nenhum alert disparou', p.dialogos, []);
    });

    H.terminar('xss');
    await navegador.close();
})().catch(function (e) { console.error(e); process.exit(1); });
