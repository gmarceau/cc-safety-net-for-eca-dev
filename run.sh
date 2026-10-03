#!/bin/sh
# ECA hook entry point.
#
# ECA runs "file" hook actions through the system shell, so this wrapper must
# be valid POSIX shell — point ECA at THIS file, never at check.mjs directly.
#
# Uses an absolute node path because a GUI-launched Emacs may not have
# /opt/homebrew/bin in its PATH.
exec /opt/homebrew/bin/node "$(dirname "$0")/check.mjs"
