@echo off
chcp 65001 >nul
title Index Celulares - Abrir Projeto
cd /d "%~dp0"

echo.
echo  O sistema agora confere o login no banco de dados, entao ele
echo  precisa do servidor local - abrir o arquivo direto no navegador
echo  mostra a tela, mas nao entra.
echo.
echo  Iniciando o servidor...
echo.

timeout /t 3 >nul
call "%~dp0iniciar-servidor.bat"
