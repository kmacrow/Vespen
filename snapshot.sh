#!/bin/bash

SNAPSHOT=`date '+hda-%F-%H:%M:%S'`

mkdir $SNAPSHOT

cp hda*.bin $SNAPSHOT/

echo "Created $SNAPSHOT"
