#!/bin/bash

SNAPSHOT=$1

if ! [ -e $SNAPSHOT ]; then
    echo "$SNAPSHOT does not exist."
    exit
fi

rm -f hda*.bin
cp $SNAPSHOT/* ./

echo "Rolled back to $SNAPSHOT"
