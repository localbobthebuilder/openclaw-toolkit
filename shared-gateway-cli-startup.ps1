function Get-ToolkitGatewayNodeCompileCachePath {
    return "/var/tmp/openclaw-compile-cache"
}

function Get-ToolkitGatewayOpenClawNoRespawnValue {
    return "1"
}

function Get-ToolkitGatewayOpenClawDockerExecArgs {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [string[]]$Arguments = @(),
        [switch]$Interactive
    )

    $dockerArgs = New-Object System.Collections.Generic.List[string]
    $dockerArgs.Add("exec")
    if ($Interactive) {
        $dockerArgs.Add("-it")
    }
    $dockerArgs.Add("-e")
    $dockerArgs.Add("OPENCLAW_NO_RESPAWN=$(Get-ToolkitGatewayOpenClawNoRespawnValue)")
    $dockerArgs.Add("-e")
    $dockerArgs.Add("NODE_COMPILE_CACHE=$(Get-ToolkitGatewayNodeCompileCachePath)")
    $dockerArgs.Add($ContainerName)
    $dockerArgs.Add("openclaw")

    foreach ($argument in @($Arguments)) {
        $dockerArgs.Add([string]$argument)
    }

    return $dockerArgs.ToArray()
}

function Get-ToolkitGatewayNodeDockerExecArgs {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [string[]]$Arguments = @(),
        [switch]$Interactive
    )

    $dockerArgs = New-Object System.Collections.Generic.List[string]
    $dockerArgs.Add("exec")
    if ($Interactive) {
        $dockerArgs.Add("-it")
    }
    $dockerArgs.Add("-e")
    $dockerArgs.Add("NODE_COMPILE_CACHE=$(Get-ToolkitGatewayNodeCompileCachePath)")
    $dockerArgs.Add($ContainerName)
    $dockerArgs.Add("node")
    $dockerArgs.Add("dist/index.js")

    foreach ($argument in @($Arguments)) {
        $dockerArgs.Add([string]$argument)
    }

    return $dockerArgs.ToArray()
}
