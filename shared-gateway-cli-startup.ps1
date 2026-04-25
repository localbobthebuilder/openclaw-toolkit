function Get-ToolkitGatewayNodeCompileCachePath {
    return "/var/tmp/openclaw-compile-cache"
}

function Get-ToolkitGatewayOpenClawNoRespawnValue {
    return "1"
}

function Get-ToolkitGatewayDockerExecArgs {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [Parameter(Mandatory = $true)][string[]]$Command,
        [switch]$Interactive,
        [switch]$IncludeOpenClawNoRespawn
    )

    $dockerArgs = New-Object System.Collections.Generic.List[string]
    $dockerArgs.Add("exec")
    if ($Interactive) {
        $dockerArgs.Add("-it")
    }
    if ($IncludeOpenClawNoRespawn) {
        $dockerArgs.Add("-e")
        $dockerArgs.Add("OPENCLAW_NO_RESPAWN=$(Get-ToolkitGatewayOpenClawNoRespawnValue)")
    }
    $dockerArgs.Add("-e")
    $dockerArgs.Add("NODE_COMPILE_CACHE=$(Get-ToolkitGatewayNodeCompileCachePath)")
    $dockerArgs.Add($ContainerName)

    foreach ($part in @($Command)) {
        $dockerArgs.Add([string]$part)
    }

    return $dockerArgs.ToArray()
}

function Get-ToolkitGatewayOpenClawDockerExecArgs {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [string[]]$Arguments = @(),
        [switch]$Interactive
    )

    return Get-ToolkitGatewayDockerExecArgs -ContainerName $ContainerName -Interactive:$Interactive -IncludeOpenClawNoRespawn -Command (@("openclaw") + @($Arguments))
}

function Get-ToolkitGatewayNodeDockerExecArgs {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [string[]]$Arguments = @(),
        [switch]$Interactive
    )

    # Legacy helper name retained for callers; run through the installed OpenClaw CLI.
    return Get-ToolkitGatewayDockerExecArgs -ContainerName $ContainerName -Interactive:$Interactive -IncludeOpenClawNoRespawn -Command (@("openclaw") + @($Arguments))
}
