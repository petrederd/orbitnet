#!/usr/bin/env bash
# Regenerates the TLS fixtures used by tests/tls.test.js.
#
# Every private key in this directory is generated solely for tests and has no
# value outside this repository. The files are intentionally named *test-only*
# and carry a comment header so secret scanners can classify them as test data.
set -euo pipefail

cd "$(dirname "$0")"
umask 022

TEST_KEY_HEADER='# TEST-ONLY KEY - generated for OrbitNet tests, not a production secret'

mark_key() {
  local file="$1"
  { printf '%s\n' "$TEST_KEY_HEADER"; cat "$file"; } > "$file.tmp"
  mv "$file.tmp" "$file"
}

new_key() {
  local file="$1" bits="$2"
  openssl genrsa -out "$file" "$bits" 2>/dev/null
  mark_key "$file"
}

# Root and intermediate authorities.
new_key test-only-root-ca.key.pem 2048
openssl req -x509 -new -key test-only-root-ca.key.pem -sha256 -days 3650 \
  -subj '/O=OrbitNet Tests/CN=OrbitNet Test Root CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -out test-only-root-ca.crt.pem

new_key test-only-intermediate-ca.key.pem 2048
openssl req -new -key test-only-intermediate-ca.key.pem \
  -subj '/O=OrbitNet Tests/CN=OrbitNet Test Intermediate CA' \
  -out test-only-intermediate-ca.csr

cat > test-only-intermediate-ca.ext <<'EOF'
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF

openssl x509 -req -in test-only-intermediate-ca.csr \
  -CA test-only-root-ca.crt.pem -CAkey test-only-root-ca.key.pem \
  -CAcreateserial -out test-only-intermediate-ca.crt.pem -days 3650 -sha256 \
  -extfile test-only-intermediate-ca.ext

# issue_leaf <name> <common-name> <san> <days> [key-bits] [extra-ext]
issue_leaf() {
  local name="$1" cn="$2" san="$3" days="$4" bits="${5:-2048}" extra="${6:-}"
  new_key "test-only-${name}.key.pem" "$bits"
  openssl req -new -key "test-only-${name}.key.pem" \
    -subj "/O=OrbitNet Tests/CN=${cn}" -out "test-only-${name}.csr"
  cat > "test-only-${name}.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=${san}
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
${extra}
EOF
  openssl x509 -req -in "test-only-${name}.csr" \
    -CA test-only-intermediate-ca.crt.pem \
    -CAkey test-only-intermediate-ca.key.pem -CAcreateserial \
    -out "test-only-${name}.crt.pem" -days "$days" -sha256 \
    -extfile "test-only-${name}.ext"
}

# The ordinary leaf certificates use a long test-only lifetime so the
# integration tests do not start failing when wall-clock time passes. They are
# never deployed and are not a model of a real CA/B-compliant certificate.
issue_leaf valid valid.example 'DNS:valid.example,DNS:www.valid.example' 3650
issue_leaf wrong-name wrong.example 'DNS:wrong.example' 3650
issue_leaf weak-key weak-key.example 'DNS:weak-key.example' 3650 1024
issue_leaf long-validity long-validity.example 'DNS:long-validity.example' 400
# The leaf is signed by the intermediate, but a server that sends only this
# certificate forms an incomplete chain.
issue_leaf incomplete incomplete.example 'DNS:incomplete.example' 3650
issue_leaf ocsp ocsp.example 'DNS:ocsp.example' 3650 2048 'authorityInfoAccess=OCSP;URI:http://ocsp.example.test'

# A deliberately expired certificate. openssl x509 -days cannot create a
# notAfter in the past, so use the small CA database interface with explicit
# dates instead.
new_key test-only-expired.key.pem 2048
openssl req -new -key test-only-expired.key.pem \
  -subj '/O=OrbitNet Tests/CN=expired.example' -out test-only-expired.csr
mkdir -p demoCA/newcerts
: > demoCA/index.txt
echo 1000 > demoCA/serial
cat > expired-ca.cnf <<'EOF'
[ ca ]
default_ca = CA_default
[ CA_default ]
dir = ./demoCA
database = $dir/index.txt
new_certs_dir = $dir/newcerts
serial = $dir/serial
default_md = sha256
policy = policy_any
x509_extensions = leaf_ext
unique_subject = no
[ policy_any ]
commonName = supplied
organizationName = optional
[ leaf_ext ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:expired.example
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF
openssl ca -batch -config expired-ca.cnf -in test-only-expired.csr \
  -cert test-only-intermediate-ca.crt.pem \
  -keyfile test-only-intermediate-ca.key.pem \
  -out test-only-expired.crt.pem \
  -startdate 20200101000000Z -enddate 20210101000000Z -notext

cat test-only-valid.crt.pem test-only-intermediate-ca.crt.pem > test-only-chain.crt.pem
cat test-only-chain.crt.pem test-only-root-ca.crt.pem > test-only-chain-with-root.crt.pem

rm -f ./*.csr ./*.ext ./*.srl demoCA/index.txt.* demoCA/serial.*
rm -rf demoCA
