// carga: usa Formato; publica RegrasPdv  (conferido por testes/front/carga.test.js)
/*
 * pdv-regras.js - as contas do PDV, sem tela. Window.RegrasPdv.
 *
 * Roda no navegador e no Node (testes\front\pdv-regras.test.js). Tudo em
 * CENTAVOS inteiros: 3 x R$ 33,33 com 10% de desconto nao pode dar uma
 * soma que o servidor recusa por um centavo.
 *
 *   totais(itens, desconto, modo)   bruto, desconto e total da venda
 *   descontoNoLimite(...)           a MESMA conta do servidor
 *                                   (conferirRegrasDaVenda, vendas.php)
 *   troco(totalCentavos, recebido)  quanto devolver (null = nao informado)
 *   buscar(itens, texto, filtro)    o que aparece na lista do PDV
 *
 * Quem decide de verdade e o servidor: estas contas so mostram ANTES de
 * enviar o que ele vai dizer.
 */
(function (raiz, fabrica) {
    const noNode = typeof module !== 'undefined' && module.exports;
    const objeto = fabrica(noNode ? require('./formato.js') : raiz.Formato);
    if (noNode) module.exports = objeto;
    else raiz.RegrasPdv = objeto;
})(this, function (Formato) {
    'use strict';

    const { emCentavos } = Formato;

    /* Numero digitado ("12,50", "12.5", 12.5) em reais; vazio ou invalido = 0. */
    function lerReais(valor) {
        if (typeof valor === 'number') return isFinite(valor) ? valor : 0;
        const texto = String(valor === null || valor === undefined ? '' : valor).trim().replace(/\s/g, '');
        if (!texto) return 0;
        // "1.234,56" -> 1234.56 ; "12,5" -> 12.5 ; "12.5" -> 12.5
        const normal = texto.indexOf(',') !== -1 ? texto.replace(/\./g, '').replace(',', '.') : texto;
        const n = Number(normal);
        return isFinite(n) ? n : 0;
    }

    /*
     * itens: [{ preco, quantidade }]; desconto: o numero digitado;
     * modo: 'reais' ou 'porcento'. O desconto nunca passa do bruto nem
     * fica negativo. Em %, arredonda para o centavo mais proximo.
     */
    function totais(itens, desconto, modo) {
        const bruto = (itens || []).reduce(function (soma, i) {
            return soma + emCentavos(lerReais(i.preco) * Math.max(0, Math.floor(Number(i.quantidade) || 0)));
        }, 0);
        const digitado = Math.max(0, lerReais(desconto));
        let descontoC = modo === 'porcento' ? Math.round(bruto * Math.min(digitado, 100) / 100) : emCentavos(digitado);
        descontoC = Math.min(Math.max(descontoC, 0), bruto);
        return { bruto: bruto, desconto: descontoC, total: bruto - descontoC,
                 percentual: bruto > 0 ? Math.round(descontoC * 10000 / bruto) / 100 : 0 };
    }

    /*
     * O limite de desconto de quem nao e admin, igual ao servidor:
     * recusa quando desconto > bruto x limite / 100 (em centavos, com o
     * mesmo arredondamento). Limite 100 = sem limite.
     */
    function descontoNoLimite(brutoC, descontoC, limitePercentual, admin) {
        const limite = Number(limitePercentual);
        if (admin || !(limite < 100)) return { ok: true, maximo: brutoC };
        const maximo = emCentavos((brutoC / 100) * limite / 100);
        return { ok: descontoC <= maximo, maximo: maximo };
    }

    /* Troco em centavos; null quando nada foi digitado. Negativo = falta dinheiro. */
    function troco(totalC, recebido) {
        if (recebido === null || recebido === undefined || String(recebido).trim() === '') return null;
        return emCentavos(lerReais(recebido)) - totalC;
    }

    /* Sem acento e em minusculas: "Película" acha "pelicula". */
    function normalizar(texto) {
        return String(texto === null || texto === undefined ? '' : texto)
            .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    }

    /*
     * A busca do PDV. Cada item traz "procura" (o texto onde procurar:
     * nome, IMEI, cor, codigo...). Todas as palavras digitadas precisam
     * aparecer. Um IMEI ou codigo digitado INTEIRO vem primeiro (leitor de
     * codigo de barras: bipou, Enter, entrou). filtro: 'todos' ou o tipo.
     */
    function buscar(itens, texto, filtro) {
        const palavras = normalizar(texto).split(/\s+/).filter(Boolean);
        const inteiro = normalizar(texto).replace(/\s+/g, '');
        return (itens || []).filter(function (i) {
            if (filtro && filtro !== 'todos' && i.tipo !== filtro) return false;
            const onde = normalizar(i.procura);
            return palavras.every(function (p) { return onde.indexOf(p) !== -1; });
        }).map(function (i, posicao) {
            const exato = inteiro.length >= 4 && (i.exatos || []).some(function (x) { return normalizar(x) === inteiro; });
            return { item: i, peso: (exato ? 0 : 1), posicao: posicao };
        }).sort(function (a, b) {
            return a.peso - b.peso || a.posicao - b.posicao;
        }).map(function (r) { return r.item; });
    }

    return { lerReais: lerReais, totais: totais, descontoNoLimite: descontoNoLimite, troco: troco,
             normalizar: normalizar, buscar: buscar };
});
