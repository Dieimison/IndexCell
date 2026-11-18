/*
 * carga.test.js - a ordem dos <script> do painel e do Login bate com o que
 * cada arquivo precisa ao carregar.
 *
 * Cada script declara na 1a linha:
 *     // carga: usa Formato, Nucleo; publica Janela
 * "usa" = objetos de window que ele le AO CARREGAR (no topo do IIFE).
 * O teste confere:
 *   1. cada "usa" foi publicado por um script carregado ANTES na mesma pagina;
 *   2. a declaracao nao mente: toda leitura janela.X / raiz.X / window.X no
 *      topo do arquivo (4 espacos de recuo) esta no "usa", e cada "publica"
 *      e de fato atribuido no arquivo;
 *   3. todo .js do Dashboard esta no dashboard.html (nenhum esquecido).
 * Trocar dois <script> de lugar, ou passar a usar um objeto sem declarar,
 * deixa este teste vermelho - antes, so quebrava o painel ao abrir.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { caso, igual, fim } = require('./caso');

const RAIZ = path.join(__dirname, '..', '..');
const OBJETOS = ['Formato', 'Dre', 'RegrasOs', 'RegrasPdv', 'Graficos', 'Nucleo', 'Janela', 'Editores'];

function scriptsDa(pagina) {
    const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
    return Array.from(html.matchAll(/<script\s+src="([^"]+)"/g)).map(function (m) {
        return path.normalize(path.join(path.dirname(pagina), m[1]));
    });
}

function declaracao(arquivo) {
    const texto = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    const m = texto.match(/^\/\/ carga: usa ([^;]*); publica ([^\s]*)/);
    if (!m) return null;
    const lista = function (s) { return s === '(nada)' ? [] : s.split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
    return { usa: lista(m[1]), publica: lista(m[2]), texto: texto };
}

/** Os problemas de uma ordem de scripts (lista vazia = ok). */
function conferirOrdem(scripts) {
    const problemas = [];
    const publicados = new Set();
    scripts.forEach(function (arquivo) {
        const d = declaracao(arquivo);
        if (!d) { problemas.push(arquivo + ': sem a linha "// carga: usa ...; publica ..."'); return; }
        d.usa.forEach(function (x) {
            if (!publicados.has(x)) problemas.push(arquivo + ' usa ' + x + ', que ainda nao foi carregado');
        });
        d.publica.forEach(function (x) { publicados.add(x); });
    });
    return problemas;
}

/** A declaracao confere com o codigo? (lista vazia = ok) */
function conferirDeclaracao(arquivo) {
    const d = declaracao(arquivo);
    if (!d) return [arquivo + ': sem declaracao'];
    const problemas = [];
    d.texto.split('\n').forEach(function (linha, i) {
        if (!/^ {0,4}\S/.test(linha) || /^\s*(\/\/|\*|\/\*)/.test(linha)) return;   // so o topo, sem comentario
        for (const m of linha.matchAll(/\b(?:janela|raiz|window)\.([A-Z]\w*)/g)) {
            const obj = m[1];
            if (OBJETOS.indexOf(obj) === -1) continue;
            if (d.usa.indexOf(obj) === -1 && d.publica.indexOf(obj) === -1) {
                problemas.push(arquivo + ':' + (i + 1) + ' le ' + obj + ' ao carregar sem declarar em "usa"');
            }
        }
    });
    d.publica.forEach(function (obj) {
        const nome = obj.replace(/\./g, '\\.');
        if (!new RegExp('(?:janela|raiz|window)\\.' + nome + '\\s*=').test(d.texto)) {
            problemas.push(arquivo + ' declara publicar ' + obj + ' mas nao atribui');
        }
    });
    return problemas;
}

const painel = scriptsDa('Dashboard/dashboard.html');
const login = scriptsDa('Login/index.html');
const loja = scriptsDa('Loja/index.html');   // v8: a vitrine do cliente

console.log('carga: ordem dos <script>');

caso('dashboard.html: cada script vem depois do que ele usa', function () {
    igual(conferirOrdem(painel), []);
});

caso('Login/index.html: cada script vem depois do que ele usa', function () {
    igual(conferirOrdem(login), []);
});

caso('Loja/index.html: cada script vem depois do que ele usa, e todo .js da Loja esta nela', function () {
    igual(conferirOrdem(loja), []);
    const todos = fs.readdirSync(path.join(RAIZ, 'Loja')).filter(function (f) { return /\.js$/.test(f); })
        .map(function (f) { return path.normalize('Loja/' + f); });
    igual(todos.filter(function (f) { return loja.indexOf(f) === -1; }), []);
});

caso('as declaracoes "carga:" batem com o codigo de cada arquivo', function () {
    igual(painel.concat(login, loja).reduce(function (t, a) { return t.concat(conferirDeclaracao(a)); }, []), []);
});

caso('todo .js do Dashboard esta no dashboard.html', function () {
    const todos = fs.readdirSync(path.join(RAIZ, 'Dashboard')).filter(function (f) { return /\.js$/.test(f); })
        .map(function (f) { return path.normalize('Dashboard/' + f); })
        .concat(fs.readdirSync(path.join(RAIZ, 'Dashboard', 'telas')).filter(function (f) { return /\.js$/.test(f); })
            .map(function (f) { return path.normalize('Dashboard/telas/' + f); }));
    igual(todos.filter(function (f) { return painel.indexOf(f) === -1; }), []);
});

caso('o teste pega a troca de ordem (janela.js depois de editores.js fica vermelho)', function () {
    const trocada = painel.slice();
    const a = trocada.indexOf(path.normalize('Dashboard/janela.js'));
    const b = trocada.indexOf(path.normalize('Dashboard/editores.js'));
    trocada[a] = painel[b];
    trocada[b] = painel[a];
    if (!conferirOrdem(trocada).length) throw new Error('a ordem trocada passou');
});

fim();
