# Prints fields/enum values/input fields of a single type from
# docs/api/schema.json. Usage: .\show-type.ps1 Customer

param(
    [Parameter(Mandatory=$true)]
    [string]$TypeName
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$schemaFile = Join-Path $root "docs\api\schema.json"

$json = Get-Content $schemaFile -Raw | ConvertFrom-Json
$type = $json.data.__schema.types | Where-Object { $_.name -eq $TypeName }

if (-not $type) {
    Write-Output "Type '$TypeName' not found."
    exit 1
}

function Format-TypeRef($t) {
    if (-not $t) { return "" }
    if ($t.kind -eq "NON_NULL") { return (Format-TypeRef $t.ofType) + "!" }
    if ($t.kind -eq "LIST") { return "[" + (Format-TypeRef $t.ofType) + "]" }
    return $t.name
}

Write-Output ("Type: " + $type.name + " (" + $type.kind + ")")
if ($type.description) { Write-Output ("Description: " + $type.description) }
Write-Output ""

if ($type.fields) {
    Write-Output "Fields:"
    foreach ($f in $type.fields) {
        $args = ($f.args | ForEach-Object { "$($_.name): $(Format-TypeRef $_.type)" }) -join ", "
        $line = "  " + $f.name + "(" + $args + "): " + (Format-TypeRef $f.type)
        Write-Output $line
        if ($f.description) { Write-Output ("    - " + $f.description) }
    }
}

if ($type.inputFields) {
    Write-Output "Input fields:"
    foreach ($f in $type.inputFields) {
        $line = "  " + $f.name + ": " + (Format-TypeRef $f.type)
        if ($f.defaultValue) { $line += " = " + $f.defaultValue }
        Write-Output $line
        if ($f.description) { Write-Output ("    - " + $f.description) }
    }
}

if ($type.enumValues) {
    Write-Output "Enum values:"
    foreach ($v in $type.enumValues) {
        $line = "  " + $v.name
        Write-Output $line
        if ($v.description) { Write-Output ("    - " + $v.description) }
    }
}
