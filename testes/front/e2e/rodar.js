/*
 * rodar.js - roda os roteiros de tela (Playwright) em ordem. Ver LEIA-ME.txt.
 *
 *     node testes\front\e2e\rodar.js            todos
 *     node testes\front\e2e\rodar.js a1-os      so um (troca-senha e massa rodam antes)
 *
 * Sozinho (o normal): cria um banco TEMPORARIO pelo dados\aplicar-estrutura.php,
 * sobe "php -S" numa porta livre apontando para ele, roda os roteiros,
 * derruba o servidor e apaga o temporario. O dados\index.sqlite nao e tocado
 * (o INDEX_CELULARES_DB herdado de quem chamou e ignorado).
 *
 * Servidor de fora: com E2E_URL definido, usa esse servidor e o banco de
 * INDEX_CELULARES_DB (que tem de ser o banco DESSE servidor, e de teste).
 *
 * Codigo de saida: 0 tudo certo; 1 algum roteiro falhou (ou o servidor nao
 * subiu); 77 Playwright/Chromium indisponivel - o testes\rodar.php mostra
 * "PULADO" e o resultado geral nao e "TUDO VERDE".
 *
 * A ordem importa: troca-senha poe a senha do admin, massa cria os dados
 * que os outros usam e bloqueio vai por ultimo (trava e destrava um usuario).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PULADO = 77;
const ORDEM = ['troca-senha', 'massa', 'fumaca', 'a1-os', 'sessao', 'janela-usuario', 'xss', 'formas', 'balcao', 'pdv', 'pedido', 'pdv-inicio', 'responsivo', 'loja', 'bloqueio'];
const SEMPRE = ['troca-senha', 'massa'];
const RAIZ = path.join(__dirname, '..', '..', '..');
const SENHA_INICIAL = 'Inicial-E2E-2026';

function phpExe() {
    if (process.env.E2E_PHP) return process.env.E2E_PHP;
    if (fs.existsSync('C:/php/php.exe')) return 'C:/php/php.exe';
    return 'php';
}

/* Playwright e o Chromium dele estao aqui? Se nao, a etapa e PULADA (77). */
async function playwrightDisponivel() {
    try {
        const { chromium } = require(process.env.E2E_PLAYWRIGHT || 'C:/Projetos/Monolito/node_modules/playwright');
        const navegador = await chromium.launch();
        await navegador.close();
        return true;
    } catch (erro) {
        console.log('PULADO: Playwright/Chromium indisponivel (' + String(erro.message).split('\n')[0] + ').');
        console.log('Instale com "npm install playwright" e "npx playwright install chromium", ou aponte E2E_PLAYWRIGHT.');
        return false;
    }
}

function portaLivre() {
    return new Promise(function (resolver, rejeitar) {
        const s = net.createServer();
        s.once('error', rejeitar);
        s.listen(0, '127.0.0.1', function () { const p = s.address().port; s.close(function () { resolver(p); }); });
    });
}

function esperarPorta(porta, tentativas) {
    return new Promise(function (resolver) {
        (function tentar(n) {
            const c = net.connect(porta, '127.0.0.1', function () { c.end(); resolver(true); });
            c.on('error', function () { if (n <= 0) resolver(false); else setTimeout(function () { tentar(n - 1); }, 200); });
        })(tentativas);
    });
}

function apagarPasta(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (erro) { /* temporario: o sistema limpa depois */ }
}

(async function () {
    if (!(await playwrightDisponivel())) { process.exitCode = PULADO; return; }

    const pedidos = process.argv.slice(2);
    const lista = pedidos.length
        ? ORDEM.filter(function (n) { return SEMPRE.indexOf(n) !== -1 || pedidos.indexOf(n) !== -1; })
        : ORDEM;

    const ambiente = Object.assign({}, process.env);
    let servidor = null;
    let tmp = null;

    if (!process.env.E2E_URL) {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'index-celulares-e2e-'));
        const banco = path.join(tmp, 'e2e.sqlite');
        const instalar = spawnSync(phpExe(), [path.join(RAIZ, 'dados', 'aplicar-estrutura.php'), banco], {
            cwd: RAIZ, encoding: 'utf8',
            env: Object.assign({}, process.env, { INDEX_CELULARES_DB: banco, INDEX_CELULARES_SENHA_INICIAL: SENHA_INICIAL }),
        });
        if (instalar.status !== 0) {
            console.log('FALHOU: o aplicar-estrutura.php nao criou o banco de teste.\n' + instalar.stdout + instalar.stderr);
            apagarPasta(tmp);
            process.exitCode = 1;
            return;
        }
        const porta = await portaLivre();
        Object.assign(ambiente, {
            INDEX_CELULARES_DB: banco, INDEX_CELULARES_BACKUPS: path.join(tmp, 'backups'),
            INDEX_CELULARES_LOG: path.join(tmp, 'erros.log'),
            E2E_URL: 'http://127.0.0.1:' + porta, E2E_SENHA_INICIAL: SENHA_INICIAL,
        });
        servidor = spawn(phpExe(), ['-S', '127.0.0.1:' + porta, 'servidor.php'], { cwd: RAIZ, env: ambiente, stdio: 'ignore' });
        if (!(await esperarPorta(porta, 50))) {
            console.log('FALHOU: o servidor de teste nao subiu na porta ' + porta + '.');
            servidor.kill();
            apagarPasta(tmp);
            process.exitCode = 1;
            return;
        }
        console.log('servidor de teste em ' + ambiente.E2E_URL + ', banco temporario ' + banco);
    }

    let falhou = 0;
    lista.forEach(function (nome) {
        console.log('\n######## ' + nome);
        const r = spawnSync(process.execPath, [path.join(__dirname, nome + '.js')], { stdio: 'inherit', env: ambiente });
        if (r.status !== 0) falhou++;
    });

    if (servidor) servidor.kill();
    if (tmp) setTimeout(function () { apagarPasta(tmp); }, 500);
    console.log('\n' + (falhou ? 'FALHOU: ' + falhou + ' de ' + lista.length + ' roteiro(s).' : 'OK: ' + lista.length + ' roteiro(s).'));
    process.exitCode = falhou ? 1 : 0;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
