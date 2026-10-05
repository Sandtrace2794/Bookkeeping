@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] 找不到 Node.js，請先安裝： https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo   記帳本 - 本機伺服器
echo   網址： http://localhost:5173
echo   要關閉請按 Ctrl+C
echo.

start "" http://localhost:5173
npx --yes serve -l 5173 .
