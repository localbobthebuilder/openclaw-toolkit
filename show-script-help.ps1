[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,
    [Parameter(Mandatory = $true)]
    [string]$WrapperName
)

$ErrorActionPreference = "Stop"

$resolvedScriptPath = (Resolve-Path -LiteralPath $ScriptPath).Path
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($resolvedScriptPath, [ref]$tokens, [ref]$parseErrors)

if (@($parseErrors).Count -gt 0) {
    $firstError = $parseErrors[0]
    throw "Unable to parse script help from '${resolvedScriptPath}': $($firstError.Message)"
}

$commonParameterNames = @(
    "Verbose",
    "Debug",
    "ErrorAction",
    "WarningAction",
    "InformationAction",
    "ProgressAction",
    "ErrorVariable",
    "WarningVariable",
    "InformationVariable",
    "OutVariable",
    "OutBuffer",
    "PipelineVariable"
)

function Test-IsMandatoryParameter {
    param($ParameterAst)

    foreach ($attribute in @($ParameterAst.Attributes)) {
        if ($attribute -is [System.Management.Automation.ParameterAttribute] -and $attribute.Mandatory) {
            return $true
        }
    }

    return $false
}

function Get-ParameterTypeName {
    param($ParameterAst)

    $typeName = $ParameterAst.StaticType.Name
    if ([string]::IsNullOrWhiteSpace($typeName)) {
        return "object"
    }

    return $typeName
}

$paramBlock = $ast.ParamBlock
$scriptParameters = if ($paramBlock) { @($paramBlock.Parameters) } else { @() }

$syntaxParts = @()
foreach ($parameter in $scriptParameters) {
    $parameterName = $parameter.Name.VariablePath.UserPath
    if ($parameterName -in $commonParameterNames) {
        continue
    }

    $typeName = Get-ParameterTypeName -ParameterAst $parameter
    $isMandatory = Test-IsMandatoryParameter -ParameterAst $parameter
    $isSwitch = $typeName -eq "SwitchParameter"
    if ($isSwitch) {
        $fragment = "-$parameterName"
    }
    else {
        $fragment = "-$parameterName <$typeName>"
    }

    if (-not $isMandatory) {
        $fragment = "[$fragment]"
    }

    $syntaxParts += $fragment
}

$syntaxLines = @(
    if (@($syntaxParts).Count -gt 0) {
        "$WrapperName $($syntaxParts -join ' ')"
    }
    else {
        "$WrapperName"
    }
)

$parameterLines = @(
    foreach ($parameter in @($scriptParameters | Sort-Object { $_.Name.VariablePath.UserPath })) {
        $parameterName = $parameter.Name.VariablePath.UserPath
        if ($parameterName -in $commonParameterNames) {
            continue
        }

        $requiredLabel = if (Test-IsMandatoryParameter -ParameterAst $parameter) { "required" } else { "optional" }
        $typeName = Get-ParameterTypeName -ParameterAst $parameter
        "-$parameterName ($typeName, $requiredLabel)"
    }
)

Write-Host "$WrapperName help" -ForegroundColor Cyan
Write-Host ""
Write-Host "Usage:" -ForegroundColor Cyan
foreach ($syntaxLine in @($syntaxLines)) {
    Write-Host "  $syntaxLine"
}

Write-Host ""
Write-Host "Help triggers:" -ForegroundColor Cyan
Write-Host "  $WrapperName help"
Write-Host "  $WrapperName -Help"
Write-Host "  $WrapperName --help"
Write-Host "  $WrapperName /?"

Write-Host ""
Write-Host "Parameters:" -ForegroundColor Cyan
if (@($parameterLines).Count -eq 0) {
    Write-Host "  No script-specific parameters."
}
else {
    foreach ($parameterLine in @($parameterLines)) {
        Write-Host "  $parameterLine"
    }
}

Write-Host ""
Write-Host "Script:" -ForegroundColor Cyan
Write-Host "  $resolvedScriptPath"
