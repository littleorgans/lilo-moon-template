set shell := ["bash", "-cu"]
set positional-arguments

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

rename $org $scope $slug:
    moon run root:rename -- "$org" "$scope" "$slug"

rename-verify:
    moon run root:rename-verify

clean:
    moon run root:clean

# Create a whole repository and inspect its relationship to the template.
new-project +args:
    moon run root:new-project -- "$@"

projects *args:
    moon run root:projects -- "$@"

project-register path:
    moon run root:project-register -- "$1"
