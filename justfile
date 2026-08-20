set shell := ["bash", "-cu"]

# Aliases over moon. No task logic lives here; moon owns the graph.

default: check

# Every gate in the repo: format, lint, typecheck, test.
check:
    moon check --all

# Fix everything that can be fixed automatically.
fix:
    moon run root:format root:lint-fix

# Exactly what CI runs, against affected projects.
ci:
    moon ci

# Install pinned toolchains and dependencies.
setup:
    moon setup

clean:
    moon clean
