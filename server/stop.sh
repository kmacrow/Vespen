#!/bin/bash

kill -9 `cat /var/run/x86jsweb.pid`
kill -9 `cat /var/run/x86jsnode.pid`

echo "Server Stopped..."

