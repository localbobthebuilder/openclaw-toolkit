[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,
    [Parameter(Mandatory = $true)]
    [string]$WrapperName
)

$ErrorActionPreference = "Stop"

$resolvedScriptPath = (Resolve-Path -LiteralPath $ScriptPath).Path
$command = Get-Command $resolvedScriptPath -ErrorAction Stop

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
    param($ParameterMetadata)

    foreach ($attribute in @($ParameterMetadata.Attributes)) {
        if ($attribute -is [System.Management.Automation.ParameterAttribute] -and $attribute.Mandatory) {
            return $true
        }
    }

    return $false
}

function Get-ParameterTypeName {
    param($ParameterMetadata)

    $typeName = $ParameterMetadata.ParameterType.Name
    if ([string]::IsNullOrWhiteSpace($typeName)) {
        return "object"
    }

    return $typeName
}

$syntaxLines = @(
    foreach ($parameterSet in @($command.ParameterSets)) {
        $syntax = $parameterSet.ToString()
        if ([string]::IsNullOrWhiteSpace($syntax)) {
            continue
        }

        "$WrapperName $syntax"
    }
)

$parameterLines = @(
    foreach ($parameterName in @($command.Parameters.Keys | Sort-Object)) {
        if ($parameterName -in $commonParameterNames) {
            continue
        }

        $parameter = $command.Parameters[$parameterName]
        $requiredLabel = if (Test-IsMandatoryParameter -ParameterMetadata $parameter) { "required" } else { "optional" }
        $typeName = Get-ParameterTypeName -ParameterMetadata $parameter
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
