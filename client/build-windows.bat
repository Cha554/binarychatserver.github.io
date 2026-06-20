@echo off
setlocal enabledelayedexpansion
REM Builds a standalone BinaryChat client .exe on Windows.
REM Requires Node.js 20+ installed (https://nodejs.org). Run from this folder
REM in a regular Command Prompt.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found on your PATH. Install it from https://nodejs.org and try again.
  exit /b 1
)

echo Installing dependencies...
call npm install
if errorlevel 1 (
  echo ERROR: npm install failed.
  exit /b 1
)

echo Bundling client.js + dependencies into a single file...
call npx esbuild client.js --bundle --platform=node --target=node18 --outfile=bundle.js
if errorlevel 1 (
  echo ERROR: bundling failed.
  exit /b 1
)

echo Generating SEA prep blob...
call node --experimental-sea-config sea-config.json
if errorlevel 1 (
  echo ERROR: SEA config generation failed. You need Node.js 20 or newer for this step.
  exit /b 1
)

if not exist dist mkdir dist

echo Locating node.exe...
set "NODEPATH="
for /f "delims=" %%i in ('where node') do (
  if not defined NODEPATH set "NODEPATH=%%i"
)
echo Using: %NODEPATH%
copy /y "%NODEPATH%" "dist\binarychat-win.exe" >nul

echo Injecting application code...
call npx postject dist\binarychat-win.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if errorlevel 1 (
  echo ERROR: postject injection failed.
  exit /b 1
)

del bundle.js sea-prep.blob >nul 2>nul

echo.
echo ============================================
echo Done! Executable created at: dist\binarychat-win.exe
echo Run it with: dist\binarychat-win.exe --server=ws://your-server-address:8080
echo.
echo NOTE: Windows Defender/SmartScreen may flag a freshly-built, unsigned exe
echo on first run since it isn't code-signed. Click "More info" -^> "Run anyway".
echo ============================================
