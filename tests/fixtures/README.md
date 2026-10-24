# TLS test fixtures

Every certificate and private key in this directory is **test-only**. The keys
have no production value, are not used by the deployed service, and are named
`test-only-*` with a comment header so secret scanners can classify them.
GitHub secret scanning and gitleaks are configured to ignore this directory
(`.github/secret_scanning.yml` and `.gitleaks.toml`).

| File | Purpose |
|---|---|
| `test-only-root-ca.*` | Test root CA |
| `test-only-intermediate-ca.*` | Test intermediate CA |
| `test-only-valid.*` | Currently valid leaf for `valid.example` (long test-only lifetime) |
| `test-only-chain.crt.pem` | Leaf + intermediate, as a normal server sends it |
| `test-only-chain-with-root.crt.pem` | Leaf + intermediate + root, for extra-root checks |
| `test-only-wrong-name.*` | Leaf for `wrong.example`, used for hostname mismatch |
| `test-only-expired.*` | Leaf with notAfter in 2021 |
| `test-only-weak-key.*` | Leaf with a 1024-bit RSA key |
| `test-only-long-validity.*` | 400-day certificate, above the current CA/B limit |
| `test-only-incomplete.*` | Leaf whose intermediate is intentionally not sent by the test server |
| `test-only-ocsp.*` | Leaf with an OCSP URL in Authority Information Access |
| `expired-ca.cnf` | Small CA config used to issue the expired fixture with explicit dates |

Regenerate everything with:

```bash
tests/fixtures/generate.sh
```

The script needs OpenSSL 3 and writes deterministic test certificates (apart
from key material and timestamps created at generation time).
