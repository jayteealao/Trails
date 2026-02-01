FROM docker.io/cloudflare/sandbox:0.7.0

# Install monolith binary for creating single-file HTML archives
RUN wget -q https://github.com/Y2Z/monolith/releases/download/v2.10.1/monolith-gnu-linux-x86_64 \
    -O /usr/local/bin/monolith && chmod +x /usr/local/bin/monolith
