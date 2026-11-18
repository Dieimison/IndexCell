@echo off
chcp 65001 >nul
rem ===========================================================
rem  Index Celulares - roda TODOS os testes (PHP + Node).
rem
rem  Usa um banco NOVO temporario e um servidor numa porta livre:
rem  o dados\index.sqlite da loja nao e tocado.
rem  Termina com "TUDO VERDE" (codigo 0), "VERDE COM ETAPA PULADA (e2e)"
rem  (codigo 0, mas a tela NAO foi testada: falta o Playwright) ou
rem  "FALHOU" (codigo 1).
rem  Saida de cada etapa: testes\saida\ (dentro do projeto, fora do git)
rem
rem  Precisa de: PHP (no PATH ou em C:\php) e Node.js (no PATH);
rem  para os roteiros de tela, Playwright (ou E2E_PLAYWRIGHT).
rem ===========================================================
cd /d "%~dp0.."

where php >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\php\php.exe" (
        set "PATH=C:\php;%PATH%"
    ) else (
        echo Nao encontrei o PHP. Veja o LEIA-ME.txt.
        exit /b 1
    )
)

php testes\rodar.php
exit /b %errorlevel%
