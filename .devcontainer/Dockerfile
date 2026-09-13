# Dev container image for Nav Beacon.
# Extends the standard TypeScript + Node base with Bubblewrap, which
# Claude Code uses to sandbox command execution.
FROM mcr.microsoft.com/devcontainers/typescript-node:24-bookworm

# Install Bubblewrap (bwrap) for sandboxed command execution.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN (type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
	&& sudo mkdir -p -m 755 /etc/apt/keyrings \
	&& out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
	&& cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
	&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
	&& sudo mkdir -p -m 755 /etc/apt/sources.list.d \
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
	&& sudo apt update \
	&& sudo apt install gh -y

# pnpm is the package manager for this repository.
RUN corepack enable \
	&& su node -c "corepack prepare pnpm@10.33.0 --activate"

# Codex needs its state directory to be writable by the remote user. Seed only
# the container-specific defaults; Codex manages the rest of this directory.
RUN install -d -m 700 -o node -g node /home/node/.codex
COPY --chown=node:node --chmod=600 codex-config.toml /home/node/.codex/config.toml
