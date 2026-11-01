@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Generation Prisma...
npm run db:generate
if errorlevel 1 goto error
echo Application des migrations PostgreSQL...
npm run db:migrate -w server
if errorlevel 1 goto error
echo Initialisation des devises et portefeuilles...
npm run db:seed
if errorlevel 1 goto error
echo Base de donnees initialisee.
pause
exit /b 0
:error
echo Une etape a echoue. Verifiez server\.env et PostgreSQL.
pause
exit /b 1
