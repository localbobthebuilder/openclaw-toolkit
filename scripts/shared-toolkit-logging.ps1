function Enable-ToolkitTimestampedOutput {
    if ($script:ToolkitTimestampedOutputEnabled) {
        return
    }

    $script:ToolkitTimestampedOutputEnabled = $true

    function global:Write-Host {
        [CmdletBinding()]
        param(
            [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
            [object[]]$Object,
            [ConsoleColor]$ForegroundColor,
            [ConsoleColor]$BackgroundColor,
            [switch]$NoNewline,
            [object]$Separator = " "
        )

        $writeParams = @{}
        if ($PSBoundParameters.ContainsKey("ForegroundColor")) {
            $writeParams.ForegroundColor = $ForegroundColor
        }
        if ($PSBoundParameters.ContainsKey("BackgroundColor")) {
            $writeParams.BackgroundColor = $BackgroundColor
        }
        if ($PSBoundParameters.ContainsKey("NoNewline")) {
            $writeParams.NoNewline = $NoNewline
        }

        $text = if ($null -eq $Object) {
            ""
        }
        else {
            ($Object | ForEach-Object {
                    if ($null -eq $_) { "" } else { [string]$_ }
                }) -join [string]$Separator
        }

        $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $lines = @($text -split "`r?`n")
        if ($lines.Count -eq 0) {
            $lines = @("")
        }

        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = "[${timestamp}] $($lines[$i])"
            $lineNoNewline = $NoNewline -and $i -eq ($lines.Count - 1)
            if ($lineNoNewline) {
                Microsoft.PowerShell.Utility\Write-Host $line @writeParams
            }
            else {
                $lineParams = @{}
                foreach ($entry in $writeParams.GetEnumerator()) {
                    if ($entry.Key -ne "NoNewline") {
                        $lineParams[$entry.Key] = $entry.Value
                    }
                }
                Microsoft.PowerShell.Utility\Write-Host $line @lineParams
            }
        }
    }
}
