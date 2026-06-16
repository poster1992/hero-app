# Generates a human-readable Markdown overview (Query/Mutation fields +
# type index) from the introspected docs/api/schema.json.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$schemaFile = Join-Path $root "docs\api\schema.json"
$outFile = Join-Path $root "docs\api\schema-overview.md"

$json = Get-Content $schemaFile -Raw | ConvertFrom-Json
$types = $json.data.__schema.types

function Format-TypeRef($t) {
    if (-not $t) { return "" }
    if ($t.kind -eq "NON_NULL") { return (Format-TypeRef $t.ofType) + "!" }
    if ($t.kind -eq "LIST") { return "[" + (Format-TypeRef $t.ofType) + "]" }
    return $t.name
}

function Format-Fields($fields) {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($f in $fields) {
        $args = ($f.args | ForEach-Object { "$($_.name): $(Format-TypeRef $_.type)" }) -join ", "
        $sig = "$($f.name)($args): $(Format-TypeRef $f.type)"
        $lines.Add("- ``" + $sig + "``")
        if ($f.description) {
            $lines.Add("  - " + $f.description)
        }
    }
    return ($lines -join "`n")
}

$queryType = $types | Where-Object { $_.name -eq $json.data.__schema.queryType.name }
$mutationType = $types | Where-Object { $_.name -eq $json.data.__schema.mutationType.name }

$out = New-Object System.Collections.Generic.List[string]
$out.Add("# HERO GraphQL Schema - Uebersicht")
$out.Add("")
$out.Add("Automatisch generiert per Introspection am 2026-06-10.")
$out.Add("Endpoint: ``https://login.hero-software.de/api/external/v7/graphql``")
$out.Add("Vollstaendiges Schema (roh): [schema.json](./schema.json)")
$out.Add("")
$out.Add("## Queries (``" + $queryType.name + "``) - " + $queryType.fields.Count + " Felder")
$out.Add("")
$out.Add((Format-Fields $queryType.fields))
$out.Add("")
$out.Add("## Mutations (``" + $mutationType.name + "``) - " + $mutationType.fields.Count + " Felder")
$out.Add("")
$out.Add((Format-Fields $mutationType.fields))
$out.Add("")
$out.Add("## Typ-Index")
$out.Add("")
$out.Add("Alle weiteren Typen (Details siehe schema.json oder scripts/show-type.ps1):")
$out.Add("")

$grouped = $types | Where-Object { $_.name -notlike '__*' -and $_.name -ne $queryType.name -and $_.name -ne $mutationType.name } | Sort-Object kind, name
foreach ($kindGroup in ($grouped | Group-Object kind)) {
    $out.Add("### " + $kindGroup.Name + " (" + $kindGroup.Count + ")")
    $out.Add("")
    foreach ($t in $kindGroup.Group) {
        if ($t.description) {
            $out.Add("- **" + $t.name + "** - " + $t.description)
        } else {
            $out.Add("- **" + $t.name + "**")
        }
    }
    $out.Add("")
}

($out -join "`n") | Out-File -FilePath $outFile -Encoding utf8
Write-Output ("Overview written to " + $outFile)
