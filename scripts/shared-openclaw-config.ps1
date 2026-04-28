function Convert-ToolkitConfigValueToJson {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [switch]$AsArray
    )

    if (($AsArray -or $Value -is [System.Array]) -and @($Value).Count -eq 0) {
        return "[]"
    }

    if ($AsArray -or $Value -is [System.Array]) {
        return (ConvertTo-Json -InputObject @($Value) -Depth 50 -Compress)
    }

    return ($Value | ConvertTo-Json -Depth 50 -Compress)
}

function Initialize-ToolkitOpenClawConfigBatch {
    $script:ToolkitOpenClawConfigOps = New-Object System.Collections.Generic.List[object]
}

function Add-ToolkitOpenClawConfigSetOperation {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [switch]$AsArray
    )

    if ($null -eq $script:ToolkitOpenClawConfigOps) {
        Initialize-ToolkitOpenClawConfigBatch
    }

    $script:ToolkitOpenClawConfigOps.Add([pscustomobject]@{
            op    = "set"
            path  = $Path
            value = (Convert-ToolkitConfigValueToJson -Value $Value -AsArray:$AsArray)
        })
}

function Add-ToolkitOpenClawConfigUnsetOperation {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($null -eq $script:ToolkitOpenClawConfigOps) {
        Initialize-ToolkitOpenClawConfigBatch
    }

    $script:ToolkitOpenClawConfigOps.Add([pscustomobject]@{
            op   = "unset"
            path = $Path
        })
}

function Test-ToolkitOpenClawConfigBatchPending {
    return $null -ne $script:ToolkitOpenClawConfigOps -and $script:ToolkitOpenClawConfigOps.Count -gt 0
}

function Clear-ToolkitOpenClawConfigBatch {
    Initialize-ToolkitOpenClawConfigBatch
}

function Invoke-ToolkitOpenClawConfigBatch {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$InvokeExternal,
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [switch]$AllowFailure
    )

    if (-not (Test-ToolkitOpenClawConfigBatchPending)) {
        return [pscustomobject]@{
            ExitCode = 0
            Output   = ""
        }
    }

    $opsJson = $script:ToolkitOpenClawConfigOps.ToArray() | ConvertTo-Json -Depth 20 -Compress
    $tempId = [guid]::NewGuid().ToString("N")
    $hostOpsPath = Join-Path ([System.IO.Path]::GetTempPath()) ("openclaw-config-batch-" + $tempId + ".json")
    $hostScriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ("openclaw-config-batch-" + $tempId + ".js")
    $containerOpsPath = "/tmp/openclaw-toolkit-config-batch-$tempId.json"
    $containerScriptPath = "/tmp/openclaw-toolkit-config-batch-$tempId.js"
    [System.IO.File]::WriteAllText($hostOpsPath, $opsJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    $applyScript = @'
const fs = require("fs");
const path = require("path");

const configPath = process.argv[2];
const operations = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
let document = {};

if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, "utf8").trim();
  if (raw) {
    try {
      document = JSON.parse(raw);
    } catch (error) {
      const repaired = raw.replace(/(?:\\r\\n|\\n|\\r)+$/g, "").trim();
      if (!repaired) {
        throw error;
      }
      document = JSON.parse(repaired);
    }
  }
}

const isIndex = (segment) => /^\d+$/.test(segment);
const createContainerFor = (nextSegment) => (isIndex(nextSegment) ? [] : {});

function ensureChild(parent, segment, nextSegment) {
  if (Array.isArray(parent)) {
    const index = Number(segment);
    if (!Number.isInteger(index)) {
      throw new Error(`Expected numeric array index, got '${segment}'`);
    }
    if (parent[index] === undefined || parent[index] === null || typeof parent[index] !== "object") {
      parent[index] = createContainerFor(nextSegment);
    }
    return parent[index];
  }

  if (!Object.prototype.hasOwnProperty.call(parent, segment) || parent[segment] === null || typeof parent[segment] !== "object") {
    parent[segment] = createContainerFor(nextSegment);
  }
  return parent[segment];
}

function getParent(targetPath, createMissing) {
  const segments = targetPath.split(".").filter(Boolean);
  if (segments.length === 0) {
    throw new Error("Config path cannot be empty.");
  }

  let parent = document;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];
    if (createMissing) {
      parent = ensureChild(parent, segment, nextSegment);
      continue;
    }

    if (Array.isArray(parent)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= parent.length || parent[index] === undefined || parent[index] === null) {
        return { parent: null, key: null };
      }
      parent = parent[index];
      continue;
    }

    if (!parent || typeof parent !== "object" || !Object.prototype.hasOwnProperty.call(parent, segment)) {
      return { parent: null, key: null };
    }
    parent = parent[segment];
  }

  return { parent, key: segments[segments.length - 1] };
}

for (const operation of operations) {
  const { parent, key } = getParent(operation.path, operation.op === "set");
  if (parent === null || key === null) {
    continue;
  }

  if (operation.op === "set") {
    const parsedValue = JSON.parse(operation.value);
    if (Array.isArray(parent) && isIndex(key)) {
      parent[Number(key)] = parsedValue;
    } else {
      parent[key] = parsedValue;
    }
    continue;
  }

  if (Array.isArray(parent) && isIndex(key)) {
    const index = Number(key);
    if (index >= 0 && index < parent.length) {
      parent.splice(index, 1);
    }
    continue;
  }

  if (parent && typeof parent === "object") {
    delete parent[key];
  }
}

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(document, null, 2) + "\n", "utf8");
'@
    [System.IO.File]::WriteAllText($hostScriptPath, $applyScript, [System.Text.UTF8Encoding]::new($false))

    try {
        $copyResult = & $InvokeExternal -FilePath "docker" -Arguments @("cp", $hostOpsPath, ("{0}:{1}" -f $ContainerName, $containerOpsPath)) -AllowFailure:$AllowFailure
        if ($copyResult.ExitCode -ne 0) {
            return $copyResult
        }

        $scriptCopyResult = & $InvokeExternal -FilePath "docker" -Arguments @("cp", $hostScriptPath, ("{0}:{1}" -f $ContainerName, $containerScriptPath)) -AllowFailure:$AllowFailure
        if ($scriptCopyResult.ExitCode -ne 0) {
            return $scriptCopyResult
        }

        $result = & $InvokeExternal -FilePath "docker" -Arguments (Get-ToolkitGatewayDockerExecArgs -ContainerName $ContainerName -Command @("node", $containerScriptPath, "/home/node/.openclaw/openclaw.json", $containerOpsPath)) -AllowFailure:$AllowFailure
        if ($result.ExitCode -eq 0) {
            Clear-ToolkitOpenClawConfigBatch
        }
        return $result
    }
    catch {
        if (-not $AllowFailure) {
            throw
        }

        return [pscustomobject]@{
            ExitCode = 1
            Output   = $_.Exception.Message
        }
    }
    finally {
        Remove-Item -LiteralPath $hostOpsPath -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $hostScriptPath -ErrorAction SilentlyContinue
        try {
            $null = & $InvokeExternal -FilePath "docker" -Arguments @("exec", "--user", "0", $ContainerName, "rm", "-f", $containerOpsPath) -AllowFailure
        }
        catch {
        }
        try {
            $null = & $InvokeExternal -FilePath "docker" -Arguments @("exec", "--user", "0", $ContainerName, "rm", "-f", $containerScriptPath) -AllowFailure
        }
        catch {
        }
    }
}
