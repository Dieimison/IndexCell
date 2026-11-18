@echo off
title Index Celulares - DEMONSTRACAO (Master, porta 5604)
cd /d "%~dp0"
set "INDEX_CELULARES_DB=%~dp0demo\demo.sqlite"
set "INDEX_CELULARES_LOG=%~dp0demo\erros.log"
set "INDEX_CELULARES_BACKUPS=%~dp0demo\backups"
echo.
echo  DEMONSTRACAO da versao 8 - banco de mentira (faixa "BANCO DE TESTE" ligada).
echo  Painel:      http://127.0.0.1:5604
echo   p / p (rapido)  admin / Loja-Teste-2026x  balcao / Caixa-Teste-2026x 
echo  Loja online: http://127.0.0.1:5604/loja
echo               cliente@demo.com / Compra-Demo-2026  (ou crie uma conta nova)
echo  Para encerrar, feche esta janela.
echo.
start "" "http://127.0.0.1:5604/Login/index.html"
C:\php\php.exe -S 127.0.0.1:5604 servidor.php
