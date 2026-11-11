FROM docker.io/cloudflare/sandbox:0.12.14@sha256:b8175e89ae5efd83987ffd5056f57c28c390fd5706d42ef70fb669e275248e7b

# Stop the build if the CA bundle still holds emSign ECC Root CA - G3, the root
# Ubuntu removed for the compromised eMudhra intermediates. monolith reads this
# bundle. The text is a line of that certificate's public key.
RUN ! grep -qF djAQBgcqhkjOPQIBBgUrgQQAIgNiAAQjpQy4LRL1KPOxst3iAhKAnjlfSU2fySU0 \
    /etc/ssl/certs/ca-certificates.crt

# Install monolith binary for creating single-file HTML archives
RUN wget -q https://github.com/Y2Z/monolith/releases/download/v2.10.1/monolith-gnu-linux-x86_64 \
    -O /usr/local/bin/monolith \
    && echo "663ca914b078e91d5a854b4a07e913c613bbbcfe8fb11a24da1a6ab23c9205df  /usr/local/bin/monolith" \
    | sha256sum -c - \
    && chmod +x /usr/local/bin/monolith
