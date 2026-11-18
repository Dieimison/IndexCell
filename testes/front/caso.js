/*
 * caso.js - o minimo de "framework" dos testes do front, em Node puro.
 *
 *   const { caso, igual, fim } = require('./caso');
 *   caso('nome', () => igual(obtido, esperado, 'o que e'));
 *   fim();   // imprime o placar e sai com codigo 1 se algo falhou
 *
 * Os valores esperados sao escritos a mao (o "oraculo"), nunca calculados
 * pela propria funcao testada.
 */
'use strict';

let passou = 0;
const falhas = [];

function caso(nome, funcao) {
    try {
        funcao();
        passou++;
        console.log('  ok    ' + nome);
    } catch (erro) {
        falhas.push(nome);
        console.log('  FALHA ' + nome + '\n        ' + erro.message);
    }
}

function igual(obtido, esperado, oque) {
    if (JSON.stringify(obtido) !== JSON.stringify(esperado)) {
        throw new Error((oque ? oque + ': ' : '') + 'esperado ' + JSON.stringify(esperado) +
                        ', veio ' + JSON.stringify(obtido));
    }
}

function perto(obtido, esperado, oque) {
    if (Math.abs(obtido - esperado) > 0.005) {
        throw new Error((oque ? oque + ': ' : '') + 'esperado ' + esperado + ', veio ' + obtido);
    }
}

function fim() {
    console.log(passou + ' passaram, ' + falhas.length + ' falharam.');
    // Arquivo que nao rodou caso nenhum tambem falha: verde vazio nao prova nada.
    if (falhas.length || passou === 0) process.exitCode = 1;
}

module.exports = { caso, igual, perto, fim };
