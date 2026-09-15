# Connectome data

## MaleCNS v1.0

Files come from Janelia's public bucket
`https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/` (listed on
[male-cns.janelia.org/download](https://male-cns.janelia.org/download/)):

| file | size | columns used |
|---|---|---|
| `body-annotations-male-cns-v1.0-minconf-0.5.feather` | 13 MB | `bodyId`, `type`, `rootSide`/`somaSide`, `superclass`, `status` |
| `body-neurotransmitters-male-cns-v1.0.feather` | 42 MB | `body`, `consensus_nt` |
| `connectome-weights-male-cns-v1.0-minconf-0.5.feather` | 1.1 GB | `body_pre`, `body_post`, `weight` |

```bash
flydrones download malecns --dir data/malecns_v1
flydrones build-brain --data-dir data/malecns_v1 --min-synapses 3 --out data/malecns_brain.npz
```

The loader accepts common column-name variants and prints what it kept. Licence: CC-BY 4.0. Credit the
MaleCNS authors when you publish anything made with it.

### Filters

| option | default | effect |
|---|---|---|
| `--min-synapses` | 3 | drop weaker neuron pairs (reconstruction noise) |
| glia / empty superclass | dropped | only neurons |
| `--core-hops N` | off | keep neurons within N synapses downstream of inputs **and** upstream of outputs |
| `--max-neurons` | off | cap the core size, keeping the most connected intermediates |

### Checking your groups

```bash
flydrones inspect --brain data/malecns_brain.npz
```

Groups with zero neurons are listed with a warning. Fix their `types` regex in a config file. Browse real
cell-type names in [neuPrint](https://neuprint.janelia.org/?dataset=male-cns%3Av1.0&qt=findneurons) or the
[MaleCNS cell type explorer](https://github.com/reiserlab/celltype-explorer-drosophila-male-cns).

## Other connectomes

- **FlyWire FAFB v783** (female brain, ~139k neurons): used by Shiu et al. and many projects. Convert its
  connectivity parquet to a `Connectome` (post, pre, signed count) and save it with `Connectome.save`.
- **BANC** (female brain and nerve cord): same approach.

## Performance notes

- `.npz` loads in seconds; building from feather takes minutes and ~6 GB RAM.
- Measured on a 2-vCPU cloud VM with numpy: a 166,700-neuron / 25.6M-connection graph runs at about
  0.6× real time with `dt = 0.5 ms` (random-graph benchmark with ~2 Hz mean firing). Real activity levels
  differ, so run `flydrones bench --brain ...` on your data.
- If the brain falls behind, the real-time loop keeps going with longer ticks and prints a warning.
