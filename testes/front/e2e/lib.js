/*
 * lib.js - o que os roteiros de tela (Playwright) usam. Como rodar e as
 * variaveis de ambiente: LEIA-ME.txt desta pasta. Quem sobe o servidor e o
 * banco temporario e o rodar.js; um roteiro sozinho precisa de E2E_URL e
 * INDEX_CELULARES_DB apontando para um servidor e um banco DE TESTE.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const BASE = process.env.E2E_URL || 'http://127.0.0.1:5621';
const BANCO = process.env.INDEX_CELULARES_DB;
const PHP = process.env.E2E_PHP || (fs.existsSync('C:/php/php.exe') ? 'C:/php/php.exe' : 'php');
const SENHA_INICIAL = process.env.E2E_SENHA_INICIAL || 'admin';   // a do admin no banco novo
const SENHA_ADMIN = 'Loja-Teste-2026';                           // a que troca-senha.js poe
const PRINTS = process.env.E2E_PRINTS || path.join(__dirname, 'prints');
const { chromium } = require(process.env.E2E_PLAYWRIGHT || 'C:/Projetos/Monolito/node_modules/playwright');

if (!BANCO) {
    console.error('Defina INDEX_CELULARES_DB com o banco de TESTE que o servidor em ' + BASE + ' esta usando.');
    process.exit(2);
}
fs.mkdirSync(PRINTS, { recursive: true });

/** SELECT direto no banco de teste; devolve as linhas como objetos. */
function sql(consulta) {
    const saida = execFileSync(PHP, [path.join(__dirname, 'q.php'), BANCO, consulta], { encoding: 'utf8' });
    return saida.trim().split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
}

const log = [];
function L() {
    const s = Array.from(arguments).map(function (x) { return typeof x === 'string' ? x : JSON.stringify(x); }).join(' ');
    console.log(s);
    log.push(s);
}

let falhas = 0;
function confere(rotulo, obtido, esperado) {
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
    if (!ok) falhas++;
    L('  ' + (ok ? 'OK   ' : 'FALHA') + ' ' + rotulo + ': ' + JSON.stringify(obtido) +
      (ok ? '' : ' (esperado ' + JSON.stringify(esperado) + ')'));
}

async function bloco(nome, f) {
    L('== ' + nome);
    try { await f(); } catch (e) { falhas++; L('  FALHA (excecao) ' + String(e.message).split('\n')[0]); }
}

async function novoContexto(navegador) {
    const ctx = await navegador.newContext({ locale: 'pt-BR', viewport: { width: 1400, height: 900 } });
    // Guarda os avisos (toasts) que aparecem, para o roteiro conferir o texto.
    await ctx.addInitScript(function () {
        window.__avisos = [];
        new MutationObserver(function (ms) {
            ms.forEach(function (m) {
                m.addedNodes.forEach(function (n) {
                    if (n.nodeType === 1 && n.classList.contains('aviso')) window.__avisos.push(n.textContent);
                });
            });
        }).observe(document, { childList: true, subtree: true });
    });
    return ctx;
}

async function novaPagina(ctx, rotulo) {
    const p = await ctx.newPage();
    p.dialogos = [];
    p.recusarConfirm = false;
    p.on('pageerror', function (e) { falhas++; L('  [' + rotulo + '] ERRO DE JS ' + e.message); });
    p.on('dialog', async function (d) {
        p.dialogos.push(d.type() + ': ' + d.message());
        if (p.recusarConfirm && d.type() === 'confirm') await d.dismiss(); else await d.accept();
    });
    return p;
}

/** Entra pela tela de Login e espera o painel. */
async function entrar(p, usuario, senha) {
    await p.goto(BASE + '/Login/index.html');
    await p.fill('#username', usuario);
    await p.fill('#password', senha);
    await p.click('#loginForm button');
    await p.waitForURL(/dashboard\.html/, { timeout: 10000 });
    await p.waitForTimeout(900);
}

async function secao(p, nome) {
    const link = 'nav a[data-secao="' + nome + '"]';
    // Menu em grupos (v9): o link pode estar num grupo fechado - abre o grupo, como a pessoa faria.
    const grupo = await p.evaluate(function (s) {
        const a = document.querySelector(s);
        const g = a && a.closest('.menu-grupo');
        return g && g.querySelector('.menu-grupo-botao').getAttribute('aria-expanded') !== 'true' ? g.dataset.grupo : null;
    }, link);
    if (grupo) await p.click('.menu-grupo[data-grupo="' + grupo + '"] .menu-grupo-botao');
    await p.click(link);
    await p.waitForTimeout(800);
}

async function print(p, nome) {
    try { await p.screenshot({ path: path.join(PRINTS, nome + '.png') }); } catch (e) { /* sem print, segue */ }
}

/** Campos invalidos pela validacao do navegador (min, max, step...). */
function invalidos(p) {
    return p.evaluate(function () {
        return Array.from(document.querySelectorAll('#modalForm :invalid'))
            .filter(function (e) { return e.tagName !== 'FORM'; })
            .map(function (e) { return e.name || e.getAttribute('data-item-qtd') !== null && 'item-qtd' || e.className; });
    });
}

function modalAberto(p) {
    return p.evaluate(function () { return !document.getElementById('modal').classList.contains('oculta'); });
}

/** O texto do aviso de erro DENTRO da janela (ou null). */
function erroDaJanela(p) {
    return p.evaluate(function () {
        const e = document.querySelector('.modal-erro');
        return e ? e.firstChild.textContent : null;
    });
}

async function salvar(p) {
    await p.click('#modalSalvar');
    await p.waitForTimeout(1200);
}

/** Chamada direta a API com a sessao da pagina (para preparar massa). */
function apiNa(p, metodo, rota, corpo) {
    return p.evaluate(async function (a) {
        const r = await fetch('/api' + a[1], { method: a[0], credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: a[2] === undefined ? undefined : JSON.stringify(a[2]) });
        return Object.assign({ status: r.status }, await r.json().catch(function () { return {}; }));
    }, [metodo, rota, corpo]);
}

function terminar(nome) {
    L(falhas ? 'RESULTADO: ' + falhas + ' FALHA(S)' : 'RESULTADO: tudo certo');
    fs.writeFileSync(path.join(PRINTS, nome + '.log'), log.join('\n'), 'utf8');
    process.exitCode = falhas ? 1 : 0;
}

module.exports = { chromium, BASE, SENHA_INICIAL, SENHA_ADMIN, sql, L, confere, bloco, novoContexto, novaPagina, entrar, secao,
                   print, invalidos, modalAberto, erroDaJanela, salvar, apiNa, terminar };
