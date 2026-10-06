@echo off
setlocal enabledelayedexpansion

echo Searching for Visual Studio...

:: Try common VS 2022 paths
set "VS_PATHS=C:\Program Files\Microsoft Visual Studio\2022\Community"
set "VS_PATHS=%VS_PATHS%;C:\Program Files\Microsoft Visual Studio\2022\Professional"
set "VS_PATHS=%VS_PATHS%;C:\Program Files\Microsoft Visual Studio\2022\Enterprise"
set "VS_PATHS=%VS_PATHS%;C:\Program Files (x86)\Microsoft Visual Studio\2019\Community"
set "VS_PATHS=%VS_PATHS%;C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional"

set "VCVARS_FOUND="
for %%P in ("%VS_PATHS:;=" "%") do (
    if exist "%%~P\VC\Auxiliary\Build\vcvars64.bat" (
        set "VCVARS_FOUND=%%~P\VC\Auxiliary\Build\vcvars64.bat"
        goto :found
    )
)

:found
if not defined VCVARS_FOUND (
    echo ERROR: Visual Studio not found!
    echo Please install Visual Studio with C++ development tools.
    exit /b 1
)

echo Found Visual Studio at: %VCVARS_FOUND%
echo Setting up build environment...

:: Call vcvars64.bat to setup environment
call "%VCVARS_FOUND%" >nul 2>&1

echo Compiling recording.dll...
cl /LD /EHsc /std:c++17 /O2 /MT recording.cpp /link /OUT:recording.dll mfplat.lib mfreadwrite.lib mfuuid.lib windowsapp.lib ole32.lib oleaut32.lib windowscodecs.lib d3d11.lib dxgi.lib

if errorlevel 1 (
    echo.
    echo ERROR: Compilation failed!
    exit /b 1
)

echo.
echo SUCCESS: recording.dll compiled successfully!
del *.obj 2>nul

exit /b 0
