@echo off
chcp 65001 >nul
title Index Celulares - Servidor Local
cd /d "%~dp0"

rem Porta e endereco podem ser trocados sem editar este arquivo:
rem   set PORTA=5600 & iniciar-servidor.bat
rem   set ENDERECO=0.0.0.0   (para outros computadores da loja acessarem)
if "%PORTA%"=="" set PORTA=5500
if "%ENDERECO%"=="" set ENDERECO=localhost

echo.
echo  ===========================================
echo   Index Celulares - Sistema de Assistencia
echo  ===========================================
echo.

rem O sistema roda com PHP. A versao em Node existiu ate a v1 do banco
rem e foi removida do projeto - o banco de hoje ela nao entende.
where php >nul 2>nul
if %errorlevel% equ 0 goto usar_php

rem PHP instalado em C:\php mas ainda fora do PATH (acontece em janelas
rem que ja estavam abertas quando o PHP foi instalado).
if exist "C:\php\php.exe" (
    set "PATH=C:\php;%PATH%"
    goto usar_php
)

goto sem_php

:usar_php
echo  Motor: PHP
echo.
echo  Servidor rodando em:
echo    http://localhost:%PORTA%
echo.
echo  Primeiro acesso: use o login e a senha inicial recebidos na
echo  instalacao (o sistema pede para trocar a senha na hora).
echo.
echo  Banco novo ou atualizado agora?  php dados\aplicar-estrutura.php
echo.
echo  Para encerrar, feche esta janela ou pressione Ctrl+C.
echo.
start "" "http://localhost:%PORTA%/Login/index.html"
php -S %ENDERECO%:%PORTA% servidor.php
goto fim

:sem_php
echo  Nao encontrei o PHP neste computador.
echo  O sistema precisa dele para conversar com o banco.
echo.
echo  Como instalar:
echo    1) Baixe em https://windows.php.net/download
echo       (escolha Thread Safe, x64, versao 8.x)
echo    2) Extraia o zip em  C:\php
echo    3) Adicione C:\php ao PATH do Windows
echo       (Iniciar ^> "variaveis de ambiente" ^> Path ^> Novo ^> C:\php)
echo    4) Copie C:\php\php.ini-development para C:\php\php.ini
echo       e tire o ponto e virgula do inicio destas linhas:
echo          extension=pdo_sqlite
echo          extension=sqlite3
echo          extension=mbstring
echo    5) Feche e abra o Prompt de Comando e rode:  php -v
echo.
echo  Depois disso, e so dar dois cliques neste arquivo de novo.
echo.
echo  ATENCAO: sem servidor, abrir o Login\index.html direto pelo
echo  arquivo mostra a tela, mas o login nao funciona (nao ha banco
echo  para consultar).
echo.

:fim
echo.
echo  Servidor encerrado.
pause
