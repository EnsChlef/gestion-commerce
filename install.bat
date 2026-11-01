@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Installation des dependances...
npm install
if errorlevel 1 goto error
echo.
echo Installation terminee. Configurez server\.env puis lancez setup-db.bat.
pause
exit /b 0
:error
echo Echec de l'installation. Verifiez Node.js et votre connexion Internet.
pause
exit /b 1
