// carga: usa (nada); publica Ambiente  (conferido por testes/front/carga.test.js)
/*
 * ambiente.js - a faixa vermelha "Banco de teste" (v8). Window.Ambiente.
 *
 * Carregado pelas tres paginas: painel (dashboard.html), login e loja
 * online. Pergunta ao servidor (GET /api/ambiente, sem sessao) se este banco
 * esta marcado como de teste - Admin > Regras > "Este banco e de teste ou
 * demonstracao" (chave sistema.banco_de_teste). Marcado, preenche o lugar
 * que a pagina reservou ([data-faixa-teste]): no painel, embaixo da barra
 * de cima; no login, no topo da tela; na loja, dentro do topo fixo.
 *
 * Desmarcado (o normal na loja de verdade), nada aparece. A barra e parada
 * (sem texto correndo), ambar com listras nas pontas. Sem servidor,
 * tambem nada: a faixa so existe quando o servidor diz que e teste.
 */
(function (janela) {
    'use strict';

    /* Uma barra parada, ambar, com listras de "obra" nas pontas: chama a atencao sem piscar nem correr. */
    const LISTRA = 'repeating-linear-gradient(-45deg,#1f1a0e 0 7px,#f2b33d 7px 14px)';
    const ESTILO =
        '.faixa-teste{display:flex;align-items:center;justify-content:center;gap:10px;min-height:28px;padding:4px 44px;' +
            'background:' + LISTRA + ' left/32px 100% no-repeat,' + LISTRA + ' right/32px 100% no-repeat,#f2b33d;' +
            'color:#1d1500;font:600 12px/1.3 Poppins,"Segoe UI",Arial,sans-serif;letter-spacing:.03em;text-align:center}' +
        '.faixa-teste[hidden]{display:none}' +
        '.faixa-teste-selo{flex:none;padding:1px 8px;border-radius:999px;background:#1d1500;color:#f2b33d;font-size:11px;letter-spacing:.08em}' +
        '.faixa-teste-texto{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';

    function desenhar(lugar) {
        if (!document.getElementById('faixaTesteEstilo')) {
            const estilo = document.createElement('style');
            estilo.id = 'faixaTesteEstilo';
            estilo.textContent = ESTILO;
            document.head.appendChild(estilo);
        }
        lugar.classList.add('faixa-teste');
        lugar.setAttribute('role', 'status');
        lugar.innerHTML = '<span class="faixa-teste-selo">TESTE</span>' +
            '<span class="faixa-teste-texto">Banco de teste: os dados daqui não são da loja</span>';
        lugar.hidden = false;
    }

    function conferir() {
        const lugares = document.querySelectorAll('[data-faixa-teste]');
        if (!lugares.length) return Promise.resolve(false);
        return fetch('/api/ambiente', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                const teste = !!(d && d.banco_de_teste);
                lugares.forEach(function (l) { if (teste) desenhar(l); else l.hidden = true; });
                document.documentElement.classList.toggle('com-faixa-teste', teste);
                return teste;
            })
            .catch(function () { return false; });   // sem servidor: sem faixa
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', conferir);
    else conferir();

    janela.Ambiente = { conferir: conferir };
})(window);
