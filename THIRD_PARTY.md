# Third-party data and software

## Connectome data (not included in this repository)

**MaleCNS v1.0** - HHMI Janelia FlyEM, University of Cambridge (Department of Zoology), MRC Laboratory of
Molecular Biology, Google Research. Licensed under **CC-BY 4.0**. Downloaded on demand by
`flydrones download malecns` from the project's public storage. Project page: https://male-cns.janelia.org/

If you publish results, videos or derived data, credit the MaleCNS authors and cite their paper.

## Model parameters

LIF neuron parameters follow Shiu P.K. et al., *Nature* 2024, and their open code
(https://github.com/philshiu/Drosophila_brain_model). No code was copied; parameters are cited.

## Browser demo

`docs/vendor/` contains an unmodified copy of three.js r170 and a few of its example modules (MIT, see
`docs/vendor/THREE_LICENSE`). The webcam mode loads MediaPipe Tasks Vision (Apache-2.0) from jsDelivr on demand.

## Optional dependencies

Installed separately by pip, each under its own licence: numpy, scipy, PyYAML, matplotlib, Pillow,
OpenCV, MediaPipe (Apache-2.0; the hand landmark model is downloaded from Google on first use),
pyarrow, pandas, djitellopy, cflib, pymavlink.
