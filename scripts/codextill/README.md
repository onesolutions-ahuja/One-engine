# scripts/codextill (retired)

The CODEXTILL page and all its scripts were removed. This folder stays only
because the deploy runner already installed on the server
(/usr/local/libexec/metadrive-oci-deploy-latest) still includes
`scripts/codextill` in its script checksum. Once that runner is
reinstalled with `scripts/oracle/install-oci-deploy-control.sh`, delete
this folder.
