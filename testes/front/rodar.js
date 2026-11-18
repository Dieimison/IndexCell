/*
 * rodar.js - roda todos os testes do front (os *.test.js desta pasta).
 *
 *     node testes\front\rodar.js
 *
 * Node puro, sem dependencia. Sai com codigo 0 se tudo passou e 1 se
 * algum arquivo falhou - e o que o testes\rodar.bat confere.
 *
 * Sai com 1 tambem quando nao acha NENHUM arquivo de teste (verde vazio
 * nao prova nada) ou quando um arquivo nao roda caso nenhum (caso.js).
 *
 * Os roteiros de tela (Playwright) rodam por "node testes\front\e2e\rodar.js",
 * que sobe o proprio servidor sobre um banco temporario: ver e2e\LEIA-ME.txt.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const arquivos = fs.readdirSync(__dirname).filter(function (f) { return /\.test\.js$/.test(f); }).sort();
if (!arquivos.length) {
    console.log('FALHOU: nenhum arquivo *.test.js em ' + __dirname + '.');
    process.exit(1);
}
let falhou = 0;

arquivos.forEach(function (f) {
    console.log('\n=== ' + f);
    const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
    if (r.status !== 0) falhou++;
});

console.log('\n' + (falhou ? 'FALHOU: ' + falhou + ' de ' + arquivos.length + ' arquivo(s) de teste.'
                           : 'OK: ' + arquivos.length + ' arquivo(s) de teste do front passaram.'));
process.exitCode = falhou ? 1 : 0;
