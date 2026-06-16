#!/bin/bash
# Orphan chrome cleanup script
# Kills chrome processes that don't belong to running daemons

DAEMON_PIDS=$(pgrep -f "session_daemon.js\|lazy_server.js" 2>/dev/null)

if [ -z "$DAEMON_PIDS" ]; then
    # No daemon running - kill all puppeteer chromes
    pkill -f "chrome-linux64/chrome" 2>/dev/null
    echo "$(date): No daemon running, killed all chrome processes"
else
    # Daemon running - find orphan chromes (not children of daemon)
    CHROME_COUNT=$(pgrep -f "chrome-linux64" 2>/dev/null | wc -l)
    if [ "$CHROME_COUNT" -gt 200 ]; then
        echo "$(date): Too many chrome processes ($CHROME_COUNT), cleaning up..."
        # Kill chrome processes that are zombies or have no parent daemon
        for PID in $(pgrep -f "chrome-linux64" 2>/dev/null); do
            PPID=$(ps -o ppid= -p $PID 2>/dev/null | tr -d ' ')
            if [ -z "$PPID" ] || [ "$PPID" = "1" ]; then
                kill $PID 2>/dev/null
            fi
        done
    fi
fi
