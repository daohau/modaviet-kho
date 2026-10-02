@echo off
title Start XAMPP + ngrok

echo Kiem tra Apache...
sc query Apache2.4 | find "RUNNING" >nul
if errorlevel 1 (
    net start Apache2.4
) else (
    echo Apache da dang chay.
)

echo.
echo Kiem tra MySQL...
sc query MySQL | find "RUNNING" >nul
if errorlevel 1 (
    net start MySQL
) else (
    echo MySQL da dang chay.
)

timeout /t 3 /nobreak >nul

ngrok config add-authtoken 3FnAgTxApPJqPs4LkCOGO8rc6yH_4SPb9VdNNvFQc1fFrmUcj >nul

ngrok http --url=clause-dweller-spiritism.ngrok-free.dev 80

pause