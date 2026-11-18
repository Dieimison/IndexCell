// carga: usa (nada); publica Formato  (conferido por testes/front/carga.test.js)
/*
 * formato.js - escapar HTML, dinheiro, percentual e datas. Window.Formato.
 *
 * Funcoes PURAS: recebem numero ou texto e devolvem numero ou texto.
 * Nada de document, estado ou API. Por isso o mesmo arquivo roda:
 *   - no navegador, como window.Formato (o Login carrega so este);
 *   - no Node, pelos testes em testes\front (require('.../formato.js')).
 *
 * Dinheiro: as contas que comparam ou somam valores andam em CENTAVOS
 * INTEIROS (emCentavos/deCentavos/somarEmCentavos), igual ao servidor.
 * Em reais, 0.1 + 0.2 nao da 0.3; em centavos, 10 + 20 da 30.
 */
(function (raiz, fabrica) {
    const objeto = fabrica();
    if (typeof module !== 'undefined' && module.exports) module.exports = objeto;
    else raiz.Formato = objeto;
})(this, function () {
    'use strict';

    // ------------------------------------------------------------------
    // Escapar HTML
    // ------------------------------------------------------------------
    /*
     * Escapa os cinco caracteres que mudam o sentido do HTML. As aspas
     * contam: o mesmo texto vai para dentro de value="..." e title="...",
     * e um nome com aspas fecharia o atributo e abriria outro (onfocus=...).
     * Serve igual para texto e para atributo.
     */
    function escapar(texto) {
        return String(texto === null || texto === undefined ? '' : texto)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ------------------------------------------------------------------
    // Dinheiro e percentual
    // ------------------------------------------------------------------
    const FORMATO_MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    /** 1234.5 -> "R$ 1.234,50". Texto, nulo ou NaN viram R$ 0,00. */
    function moeda(valor) {
        return FORMATO_MOEDA.format(Number(valor) || 0);
    }

    /** 12.345 -> "12,3%" (uma casa, virgula). */
    function porcento(valor) {
        return (Math.round((Number(valor) || 0) * 10) / 10).toString().replace('.', ',') + '%';
    }

    /** Valor em reais (numero ou texto com virgula) -> centavos INTEIROS. */
    function emCentavos(valor) {
        const n = Number(String(valor === null || valor === undefined ? '' : valor).replace(',', '.'));
        return Number.isFinite(n) ? Math.round(n * 100) : 0;
    }

    /** Centavos inteiros -> reais (numero). */
    function deCentavos(centavos) {
        return centavos / 100;
    }

    /** Reais arredondados ao centavo: arredondarCentavo(0.1 + 0.2) = 0.3. */
    function arredondarCentavo(valor) {
        return deCentavos(emCentavos(valor));
    }

    /** Soma em centavos o valor que campo(item) devolve; resultado em reais. */
    function somarEmCentavos(lista, campo) {
        return deCentavos((lista || []).reduce(function (soma, item) {
            return soma + emCentavos(campo(item));
        }, 0));
    }

    // ------------------------------------------------------------------
    // Datas
    // ------------------------------------------------------------------
    /*
     * As contas de periodo andam em texto "AAAA-MM-DD" e em UTC: com a hora
     * local, um "+1 dia" no domingo da virada do horario de verao devolveria
     * o mesmo dia. Ja o "hoje" e o do relogio LOCAL da loja - e o unico
     * "hoje" do painel (depois das 21h, o de UTC ja seria amanha).
     */
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                   'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    /** "2026-03-05 10:00" -> "05/03/2026"; vazio -> "—". */
    function dataCurta(texto) {
        if (!texto) return '—';
        const partes = String(texto).substring(0, 10).split('-');
        if (partes.length !== 3) return texto;
        return partes[2] + '/' + partes[1] + '/' + partes[0];
    }

    /** "2026-03-05" -> "05/03". */
    function dataBr(texto) {
        const p = String(texto).substring(0, 10).split('-');
        return p[2] + '/' + p[1];
    }

    /** "2026-03" ou "2026-03-05" -> "03/2026". */
    function mesAno(texto) {
        const p = String(texto).split('-');
        return p[1] + '/' + p[0];
    }

    /** "2026-03-05 14:07:00" -> "14:07". */
    function horaCurta(texto) {
        return texto ? String(texto).substring(11, 16) : '';
    }

    /** "2026-03" -> "mar/26" (rotulo curto do eixo do grafico). */
    function rotuloMes(texto) {
        const partes = String(texto).split('-');
        if (partes.length < 2) return texto;
        return MESES[Number(partes[1]) - 1] + '/' + partes[0].substring(2);
    }

    function paraData(texto) {
        const p = String(texto).substring(0, 10).split('-').map(Number);
        return new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1));
    }

    function paraTexto(data) {
        return data.toISOString().substring(0, 10);
    }

    function somarDias(texto, n) {
        const d = paraData(texto);
        d.setUTCDate(d.getUTCDate() + n);
        return paraTexto(d);
    }

    function somarMeses(texto, n) {
        const d = paraData(texto);
        d.setUTCMonth(d.getUTCMonth() + n);
        return paraTexto(d);
    }

    function diasEntre(de, ate) {
        return Math.round((paraData(ate) - paraData(de)) / 86400000);
    }

    /** Hoje no relogio LOCAL, em AAAA-MM-DD. "agora" so existe para o teste. */
    function hoje(agora) {
        const d = agora || new Date();
        return d.getFullYear() + '-' +
               String(d.getMonth() + 1).padStart(2, '0') + '-' +
               String(d.getDate()).padStart(2, '0');
    }

    return {
        escapar: escapar,
        moeda: moeda, porcento: porcento,
        emCentavos: emCentavos, deCentavos: deCentavos,
        arredondarCentavo: arredondarCentavo, somarEmCentavos: somarEmCentavos,
        dataCurta: dataCurta, dataBr: dataBr, mesAno: mesAno, horaCurta: horaCurta, rotuloMes: rotuloMes,
        paraData: paraData, paraTexto: paraTexto, somarDias: somarDias, somarMeses: somarMeses,
        diasEntre: diasEntre, hoje: hoje,
    };
});
