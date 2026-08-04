# @pipeworx/chembl

[ChEMBL](https://www.ebi.ac.uk/chembl/) MCP — drug-discovery database from EBI: bioactive molecules, drug targets, mechanism of action, clinical phases. Keyless.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

- `search(query, type?, limit?)` — search molecules / targets / assays / docs
- `molecule(chembl_id)` — full molecule record
- `target(chembl_id)` — target (protein) record
- `mechanism(chembl_id)` — raw mechanism rows for one exact molecule ID
- `chembl_mechanism(drug | molecule_chembl_id, candidates?, limit?)` — mechanism of action
  from a drug **name**. Searches every molecule form the name matched (base + salts) in one
  mechanism query, so drugs whose pharmacology is curated on the salt still resolve —
  e.g. metformin's two mechanisms live on `CHEMBL1703` (METFORMIN HYDROCHLORIDE), while the
  best name match `CHEMBL1431` (METFORMIN) has none. Returns action_type, mechanism text,
  named target + organism, the form each mechanism was recorded on, and PubMed refs.
- `activities(molecule_chembl_id?, target_chembl_id?, limit?)` — activity records
- `drug_indications(molecule_chembl_id?, mesh_id?, limit?)` — disease indications

## Data source

`https://www.ebi.ac.uk/chembl/api/data/`

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "chembl": {
      "url": "https://gateway.pipeworx.io/chembl/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Chembl data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
