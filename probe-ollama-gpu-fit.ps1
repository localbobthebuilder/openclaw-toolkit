[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [string]$Model,
    [string]$EndpointKey,
    [string]$ConfigPath,
    [int]$StartContextWindow = 4096,
    [int]$ContextStep = 20480,
    [int]$MaxContextWindow = 262144,
    [int]$HeadroomMiB = 1536,
    [int]$MinimumContextWindow = 24576,
    [string]$Prompt = "Reply with OK only.",
    [string]$KeepAlive = "5m",
    [int]$Samples = 4,
    [int]$SampleIntervalSeconds = 3,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "openclaw-bootstrap.config.json"
}

. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-config-paths.ps1")
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "shared-ollama-endpoints.ps1")

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Detail {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::DarkGray
    )

    Write-Host "    $Message" -ForegroundColor $Color
}

function Invoke-OllamaCli {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )

    $command = Get-Command "ollama" -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "The 'ollama' CLI is required."
    }

    $oldHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = Get-ToolkitOllamaHostBaseUrl -Endpoint $Endpoint
        $output = & $command.Source @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        if ($null -eq $oldHost) {
            Remove-Item Env:OLLAMA_HOST -ErrorAction SilentlyContinue
        }
        else {
            $env:OLLAMA_HOST = $oldHost
        }
    }

    $text = (@($output) | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): ollama $($Arguments -join ' ')`n$text"
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $text
    }
}

function Convert-DisplayedSizeToMiB {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }

    $match = [regex]::Match($Text.Trim(), '^(?<value>[0-9]+(?:\.[0-9]+)?)\s*(?<unit>[KMGTP]?B)$', 'IgnoreCase')
    if (-not $match.Success) {
        return $null
    }

    $value = [double]$match.Groups["value"].Value
    $unit = $match.Groups["unit"].Value.ToUpperInvariant()
    switch ($unit) {
        "KB" { return [int][math]::Round($value / 1024) }
        "MB" { return [int][math]::Round($value) }
        "GB" { return [int][math]::Round($value * 1024) }
        "TB" { return [int][math]::Round($value * 1024 * 1024) }
        default { return $null }
    }
}

function Get-OllamaLine {
    param(
        [Parameter(Mandatory = $true)]$Endpoint,
        [Parameter(Mandatory = $true)][string]$TargetModel
    )

    $psText = (Invoke-OllamaCli -Endpoint $Endpoint -Arguments @("ps") -AllowFailure).Output
    return ($psText -split "(`r`n|`n|`r)" | Where-Object { $_ -match [regex]::Escape($TargetModel) } | Select-Object -First 1)
}

function Parse-OllamaLine {
    param([string]$Line)

    if ([string]::IsNullOrWhiteSpace($Line)) {
        return [pscustomobject]@{
            Size      = ""
            SizeMiB   = $null
            Processor = ""
            Context   = ""
            ContextWindow = $null
        }
    }

    $normalized = ($Line -replace '\s{2,}', '|').Trim('|')
    $parts = $normalized -split '\|'
    if ($parts.Count -lt 5) {
        return [pscustomobject]@{
            Size      = ""
            SizeMiB   = $null
            Processor = ""
            Context   = ""
            ContextWindow = $null
        }
    }

    $size = $parts[2].Trim()
    $contextText = $parts[4].Trim()
    $contextWindow = $null
    $parsedContextWindow = 0
    if ([int]::TryParse($contextText, [ref]$parsedContextWindow)) {
        $contextWindow = [int]$parsedContextWindow
    }
    return [pscustomobject]@{
        Size      = $size
        SizeMiB   = Convert-DisplayedSizeToMiB -Text $size
        Processor = $parts[3].Trim()
        Context   = $contextText
        ContextWindow = $contextWindow
    }
}

function Get-LocalGpuSnapshot {
    $query = & nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits 2>$null
    if (-not $query) {
        throw "Could not query nvidia-smi."
    }

    $firstLine = @($query)[0]
    $parts = @($firstLine -split ',') | ForEach-Object { $_.Trim() }
    if ($parts.Count -lt 3) {
        throw "Could not parse nvidia-smi output."
    }

    return [pscustomobject]@{
        Name     = [string]$parts[0]
        TotalMiB = [int]$parts[1]
        UsedMiB  = [int]$parts[2]
    }
}

function Get-EndpointGpuTelemetry {
    param([Parameter(Mandatory = $true)]$Endpoint)

    $telemetry = $null
    if ($Endpoint.PSObject.Properties.Name -contains "telemetry") {
        $telemetry = $Endpoint.telemetry
    }

    $kind = if ($telemetry -and $telemetry.PSObject.Properties.Name -contains "kind" -and $telemetry.kind) {
        ([string]$telemetry.kind).ToLowerInvariant()
    }
    else {
        "local-nvidia-smi"
    }

    switch ($kind) {
        "local-nvidia-smi" {
            $snapshot = Get-LocalGpuSnapshot
            return [pscustomobject]@{
                Kind     = $kind
                TotalMiB = [int]$snapshot.TotalMiB
                UsedMiB  = [int]$snapshot.UsedMiB
                Name     = [string]$snapshot.Name
            }
        }
        "static-gpu-total" {
            if (-not $telemetry.gpuTotalMiB) {
                throw "Endpoint '$($Endpoint.key)' uses telemetry.kind=static-gpu-total but has no telemetry.gpuTotalMiB."
            }

            return [pscustomobject]@{
                Kind     = $kind
                TotalMiB = [int]$telemetry.gpuTotalMiB
                UsedMiB  = $null
                Name     = if ($telemetry.PSObject.Properties.Name -contains "gpuName") { [string]$telemetry.gpuName } else { "" }
            }
        }
        default {
            throw "Unsupported endpoint telemetry kind '$kind' for endpoint '$($Endpoint.key)'."
        }
    }
}

if (-not (Get-Command "ollama" -ErrorAction SilentlyContinue)) {
    throw "The 'ollama' CLI is required."
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$config = Resolve-PortableConfigPaths -Config $config -BaseDir (Split-Path -Parent $ConfigPath)

$endpoint = Get-ToolkitOllamaEndpoint -Config $config -EndpointKey $EndpointKey
if ($null -eq $endpoint) {
    throw "Unknown Ollama endpoint key: $EndpointKey"
}

$gpu = Get-EndpointGpuTelemetry -Endpoint $endpoint
$budgetMiB = [int]($gpu.TotalMiB - $HeadroomMiB)
if ($budgetMiB -le 0) {
    throw "HeadroomMiB=$HeadroomMiB leaves no usable VRAM budget on endpoint '$($endpoint.key)'."
}

$results = New-Object System.Collections.Generic.List[object]
$selected = $null
$context = [int]$StartContextWindow
$lastEffectiveContextWindow = $null

Write-Detail ("Endpoint: {0} ({1})" -f $endpoint.key, (Get-ToolkitOllamaHostBaseUrl -Endpoint $endpoint))
Write-Detail ("GPU total={0} MiB, required headroom={1} MiB, budget={2} MiB" -f $gpu.TotalMiB, $HeadroomMiB, $budgetMiB)

while ($context -le $MaxContextWindow) {
    Write-Step "$Model at ctx=$context"
    Invoke-OllamaCli -Endpoint $endpoint -Arguments @("stop", $Model) -AllowFailure | Out-Null
    Start-Sleep -Seconds 3

    $payload = @{
        model      = $Model
        prompt     = $Prompt
        stream     = $false
        keep_alive = $KeepAlive
        options    = @{
            num_ctx     = $context
            num_predict = 8
        }
    }

    $job = Start-Job -ScriptBlock {
        param($BaseUrl, $Body)
        $json = $Body | ConvertTo-Json -Depth 10
        $uri = ([string]$BaseUrl).TrimEnd("/") + "/api/generate"
        try {
            Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json | Out-Null
        }
        catch {
        }
    } -ArgumentList (Get-ToolkitOllamaHostBaseUrl -Endpoint $endpoint), $payload

    $peak = 0
    for ($i = 0; $i -lt $Samples; $i++) {
        Start-Sleep -Seconds $SampleIntervalSeconds
        if ($gpu.Kind -eq "local-nvidia-smi") {
            $gpuSample = Get-LocalGpuSnapshot
            if ($gpuSample.UsedMiB -gt $peak) {
                $peak = [int]$gpuSample.UsedMiB
            }
        }
        if ($job.State -match "Completed|Failed|Stopped") {
            break
        }
    }

    Wait-Job $job -Timeout 25 | Out-Null
    Receive-Job $job | Out-Null
    Remove-Job $job -Force

    Start-Sleep -Seconds 2
    $parsed = Parse-OllamaLine -Line (Get-OllamaLine -Endpoint $endpoint -TargetModel $Model)
    Invoke-OllamaCli -Endpoint $endpoint -Arguments @("stop", $Model) -AllowFailure | Out-Null
    Start-Sleep -Seconds 4

    $estimatedUsageMiB = if ($gpu.Kind -eq "local-nvidia-smi") { $peak } else { $parsed.SizeMiB }
    $fitsBudget = $null -ne $estimatedUsageMiB -and $estimatedUsageMiB -le $budgetMiB
    $fullGpu = $parsed.Processor -eq "100% GPU"
    $effectiveContextWindow = if ($null -ne $parsed.ContextWindow) { [int]$parsed.ContextWindow } else { [int]$context }

    $result = [pscustomobject]@{
        Model             = $Model
        EndpointKey       = [string]$endpoint.key
        RequestedContextWindow = [int]$context
        ContextWindow     = [int]$effectiveContextWindow
        EstimatedUsageMiB = $estimatedUsageMiB
        PeakMiB           = if ($gpu.Kind -eq "local-nvidia-smi") { [int]$peak } else { $null }
        Size              = $parsed.Size
        SizeMiB           = $parsed.SizeMiB
        Processor         = $parsed.Processor
        LoadedContext     = $parsed.Context
        FitsBudget        = [bool]$fitsBudget
        FullGpu           = [bool]$fullGpu
        MeetsMinimum      = [bool]($effectiveContextWindow -ge $MinimumContextWindow)
    }
    $results.Add($result)

    $status = if ($fitsBudget -and $fullGpu) { "PASS" } elseif ($fullGpu) { "Budget exceeded" } else { "Offload" }
    $color = if ($fitsBudget -and $fullGpu) { [ConsoleColor]::Green } else { [ConsoleColor]::Yellow }
    Write-Detail ("usage={0} MiB, size={1}, processor={2}, loadedCtx={3}, verdict={4}" -f $estimatedUsageMiB, $parsed.Size, $parsed.Processor, $parsed.Context, $status) $color

    if ($fitsBudget -and $fullGpu) {
        $selected = $result
        if ($null -ne $lastEffectiveContextWindow -and $effectiveContextWindow -le $lastEffectiveContextWindow) {
            break
        }
        $lastEffectiveContextWindow = $effectiveContextWindow
        $context += [int]$ContextStep
        continue
    }

    break
}

Write-Step "Summary"
foreach ($result in $results) {
    $marker = if ($selected -and $result.ContextWindow -eq $selected.ContextWindow) { "*" } else { "-" }
    Write-Detail ("{0} ctx={1} requested={2} usage={3} MiB processor={4} size={5}" -f $marker, $result.ContextWindow, $result.RequestedContextWindow, $result.EstimatedUsageMiB, $result.Processor, $result.Size)
}

if ($selected) {
    Write-Host ""
    Write-Host ("Selected context for {0} on {1}: {2}" -f $Model, $endpoint.key, $selected.ContextWindow) -ForegroundColor Green
}
else {
    Write-Host ""
    Write-Host ("No tested context met the full-GPU + {0} MiB headroom rule." -f $HeadroomMiB) -ForegroundColor Yellow
}

if ($Json) {
    $selectedContextWindow = $null
    if ($selected) {
        $selectedContextWindow = [int]$selected.ContextWindow
    }

    $summary = [ordered]@{
        model                 = $Model
        endpointKey           = [string]$endpoint.key
        endpointBaseUrl       = Get-ToolkitOllamaHostBaseUrl -Endpoint $endpoint
        gpuTelemetryKind      = [string]$gpu.Kind
        gpuTotalMiB           = [int]$gpu.TotalMiB
        headroomMiB           = [int]$HeadroomMiB
        budgetMiB             = [int]$budgetMiB
        minimumContextWindow  = [int]$MinimumContextWindow
        selectedContextWindow = $selectedContextWindow
        selected              = $selected
        results               = $results.ToArray()
    }

    Write-Output ($summary | ConvertTo-Json -Depth 10 -Compress)
}
