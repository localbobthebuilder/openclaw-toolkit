[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [string]$Model,
    [string[]]$Contexts,
    [int]$BudgetMiB = 29000,
    [string]$Prompt = "Reply with OK only.",
    [string]$KeepAlive = "5m",
    [int]$Samples = 4,
    [int]$SampleIntervalSeconds = 3,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

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

function Get-GpuSnapshot {
    $text = (& nvidia-smi) -join [Environment]::NewLine
    $match = [regex]::Match(
        $text,
        '\|\s*0\s+NVIDIA GeForce RTX 5090.*?\|\s*([0-9]+)MiB /\s*([0-9]+)MiB\s*\|\s*([0-9]+)%',
        'Singleline'
    )
    if (-not $match.Success) {
        throw "Could not parse nvidia-smi output."
    }

    return [pscustomobject]@{
        UsedMiB  = [int]$match.Groups[1].Value
        TotalMiB = [int]$match.Groups[2].Value
        GpuUtil  = [int]$match.Groups[3].Value
    }
}

function Get-OllamaLine {
    param([Parameter(Mandatory = $true)][string]$TargetModel)

    $psText = (& ollama ps) -join [Environment]::NewLine
    return ($psText -split "(`r`n|`n|`r)" | Where-Object { $_ -match [regex]::Escape($TargetModel) } | Select-Object -First 1)
}

function Parse-OllamaLine {
    param([string]$Line)

    if ([string]::IsNullOrWhiteSpace($Line)) {
        return [pscustomobject]@{
            Size      = ""
            Processor = ""
            Context   = ""
        }
    }

    $normalized = ($Line -replace '\s{2,}', '|').Trim('|')
    $parts = $normalized -split '\|'
    if ($parts.Count -lt 5) {
        return [pscustomobject]@{
            Size      = ""
            Processor = ""
            Context   = ""
        }
    }

    return [pscustomobject]@{
        Size      = $parts[2].Trim()
        Processor = $parts[3].Trim()
        Context   = $parts[4].Trim()
    }
}

if (-not $Contexts -or $Contexts.Count -eq 0) {
    throw "Provide at least one context size via -Contexts."
}

$normalizedContexts = @()
foreach ($entry in @($Contexts)) {
    $pieces = @($entry -split '[,;\s]+') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    foreach ($piece in @($pieces)) {
        $parsed = 0
        if (-not [int]::TryParse($piece, [ref]$parsed)) {
            throw "Invalid context value: $piece"
        }
        $normalizedContexts += $parsed
    }
}

if (@($normalizedContexts).Count -eq 0) {
    throw "No valid context values were parsed from -Contexts."
}

Write-Detail ("Parsed contexts: " + (@($normalizedContexts) -join ", "))

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    throw "The 'ollama' CLI is required."
}

if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    throw "The 'nvidia-smi' CLI is required."
}

$apiUrl = "http://127.0.0.1:11434/api/generate"
$results = New-Object System.Collections.Generic.List[object]
$selected = $null

foreach ($ctx in $normalizedContexts) {
    Write-Step "$Model at ctx=$ctx"
    & ollama stop $Model | Out-Null
    Start-Sleep -Seconds 4

    $payload = @{
        model      = $Model
        prompt     = $Prompt
        stream     = $false
        keep_alive = $KeepAlive
        options    = @{
            num_ctx     = $ctx
            num_predict = 8
        }
    }

    $job = Start-Job -ScriptBlock {
        param($Url, $Body)
        $json = $Body | ConvertTo-Json -Depth 6
        try {
            Invoke-RestMethod -Method Post -Uri $Url -ContentType "application/json" -Body $json | Out-Null
        }
        catch {
        }
    } -ArgumentList $apiUrl, $payload

    $peak = 0
    for ($i = 0; $i -lt $Samples; $i++) {
        Start-Sleep -Seconds $SampleIntervalSeconds
        $gpu = Get-GpuSnapshot
        if ($gpu.UsedMiB -gt $peak) {
            $peak = $gpu.UsedMiB
        }
        if ($job.State -match "Completed|Failed|Stopped") {
            break
        }
    }

    Wait-Job $job -Timeout 25 | Out-Null
    Receive-Job $job | Out-Null
    Remove-Job $job -Force

    Start-Sleep -Seconds 2
    $parsed = Parse-OllamaLine -Line (Get-OllamaLine -TargetModel $Model)
    & ollama stop $Model | Out-Null
    Start-Sleep -Seconds 5

    $fitsBudget = $peak -le $BudgetMiB
    $fullGpu = $parsed.Processor -eq "100% GPU"
    $result = [pscustomobject]@{
        Model         = $Model
        ContextWindow = $ctx
        PeakMiB       = $peak
        Size          = $parsed.Size
        Processor     = $parsed.Processor
        LoadedContext = $parsed.Context
        FitsBudget    = $fitsBudget
        FullGpu       = $fullGpu
    }
    $results.Add($result)

    $status = if ($fitsBudget -and $fullGpu) { "PASS" } elseif ($fullGpu) { "Too much VRAM" } else { "Offload" }
    $color = if ($fitsBudget -and $fullGpu) { [ConsoleColor]::Green } else { [ConsoleColor]::Yellow }
    Write-Detail ("peak={0} MiB, size={1}, processor={2}, loadedCtx={3}, verdict={4}" -f $peak, $parsed.Size, $parsed.Processor, $parsed.Context, $status) $color

    if ($fitsBudget -and $fullGpu) {
        $selected = $result
        break
    }
}

Write-Step "Summary"
foreach ($result in $results) {
    $marker = if ($selected -and $result.ContextWindow -eq $selected.ContextWindow) { "*" } else { "-" }
    Write-Detail ("{0} ctx={1} peak={2} MiB processor={3} size={4}" -f $marker, $result.ContextWindow, $result.PeakMiB, $result.Processor, $result.Size)
}

if ($selected) {
    Write-Host ""
    Write-Host ("Selected context for {0}: {1}" -f $Model, $selected.ContextWindow) -ForegroundColor Green
}
else {
    Write-Host ""
    Write-Host ("No tested context met the full-GPU + <= {0} MiB budget rule." -f $BudgetMiB) -ForegroundColor Yellow
}

if ($Json) {
    $selectedContextWindow = $null
    if ($selected) {
        $selectedContextWindow = [int]$selected.ContextWindow
    }
    $selectedSummary = $null
    if ($selected) {
        $selectedSummary = [pscustomobject]@{
            Model         = $selected.Model
            ContextWindow = [int]$selected.ContextWindow
            PeakMiB       = [int]$selected.PeakMiB
            Size          = $selected.Size
            Processor     = $selected.Processor
            LoadedContext = $selected.LoadedContext
            FitsBudget    = [bool]$selected.FitsBudget
            FullGpu       = [bool]$selected.FullGpu
        }
    }
    $resultsSummary = @(
        foreach ($result in $results) {
            [pscustomobject]@{
                Model         = $result.Model
                ContextWindow = [int]$result.ContextWindow
                PeakMiB       = [int]$result.PeakMiB
                Size          = $result.Size
                Processor     = $result.Processor
                LoadedContext = $result.LoadedContext
                FitsBudget    = [bool]$result.FitsBudget
                FullGpu       = [bool]$result.FullGpu
            }
        }
    )

    $summary = [ordered]@{
        model                 = $Model
        budgetMiB             = $BudgetMiB
        selectedContextWindow = $selectedContextWindow
        selected              = $selectedSummary
        results               = $resultsSummary
    }
    Write-Output ($summary | ConvertTo-Json -Depth 10 -Compress)
}
