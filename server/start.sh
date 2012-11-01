#!/bin/bash

python -m SimpleHTTPServer 8000 &
echo $! > /var/run/x86jsweb.pid
node server.js &
echo $! > /var/run/x86jsnode.pid

echo "Server Running..."
echo "Navigate to http://localhost:8000/admin to manage it."
