set shell := ["bash", "-cu"]

# Aliases over moon. No task logic lives here; moon owns the graph.

default: check

# Fix what is mechanically fixable, then verify everything including the fixes.
check:
    moon run root:format root:lint-fix
    moon check --all

# Read-only, exactly what CI runs. Fails on anything unformatted or unfixed.
ci:
    moon ci

# Install pinned toolchains and dependencies.
setup:
    moon setup

clean:
    moon clean
